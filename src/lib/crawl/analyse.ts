import * as cheerio from 'cheerio';
import type { FetchResult } from './fetcher';

export type JsonLdBlock = { valid: boolean; types: string[]; sameAs: string[]; raw: string };

export type PageAnalysis = {
  url: string;
  depth: number;
  statusCode: number | null;
  contentType: string | null;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  h1: string | null;
  h1Count: number;
  headingOutline: { level: number; text: string }[];
  headingSkips: number;
  wordCount: number;
  /** Visible text characters ÷ raw HTML characters. Low means a JS shell. */
  textRatio: number;
  /** Content is very likely only present after client-side hydration. */
  jsDependent: boolean;
  jsDependentReason: string | null;
  jsonldBlocks: number;
  jsonldInvalid: number;
  jsonldTypes: string[];
  sameAs: string[];
  hasFaqSchema: boolean;
  hasFaq: boolean;
  questionHeadings: number;
  /** A short, direct answer in the first paragraph — what engines lift verbatim. */
  hasDirectAnswer: boolean;
  listCount: number;
  tableCount: number;
  dateModified: string | null;
  author: string | null;
  canonical: string | null;
  noindex: boolean;
  internalLinks: string[];
  error?: string;
};

const BLOCK_STRIP = 'script, style, noscript, template, svg, iframe, nav, footer, header, aside';

/** Framework mount points that are empty until JS runs. */
const SPA_ROOTS = ['#root', '#__next', '#app', '#application', '[data-reactroot]', 'astro-island'];

export function analysePage(res: FetchResult, depth: number): PageAnalysis {
  const empty: PageAnalysis = {
    url: res.finalUrl || res.url,
    depth,
    statusCode: res.statusCode,
    contentType: res.contentType,
    title: null,
    titleLength: 0,
    metaDescription: null,
    h1: null,
    h1Count: 0,
    headingOutline: [],
    headingSkips: 0,
    wordCount: 0,
    textRatio: 0,
    jsDependent: false,
    jsDependentReason: null,
    jsonldBlocks: 0,
    jsonldInvalid: 0,
    jsonldTypes: [],
    sameAs: [],
    hasFaqSchema: false,
    hasFaq: false,
    questionHeadings: 0,
    hasDirectAnswer: false,
    listCount: 0,
    tableCount: 0,
    dateModified: null,
    author: null,
    canonical: null,
    noindex: false,
    internalLinks: [],
  };

  if (res.error) return { ...empty, error: res.error };
  if (!res.body.trim()) return { ...empty, error: 'Empty response body' };
  const isHtml = !res.contentType || /html|xml/i.test(res.contentType);
  if (!isHtml) return { ...empty, error: `Not HTML (${res.contentType})` };

  const $ = cheerio.load(res.body);
  const pageUrl = new URL(res.finalUrl || res.url);

  // ── text and structure ──────────────────────────────────────────────────
  const bodyClone = $('body').clone();
  bodyClone.find(BLOCK_STRIP).remove();
  const visibleText = bodyClone.text().replace(/\s+/g, ' ').trim();
  const wordCount = visibleText ? visibleText.split(' ').filter(Boolean).length : 0;
  const textRatio = res.body.length ? visibleText.length / res.body.length : 0;

  const headingOutline: { level: number; text: string }[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = (el as { tagName?: string }).tagName ?? '';
    const level = Number(tag.replace(/^h/i, ''));
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (level >= 1 && level <= 6 && text) headingOutline.push({ level, text });
  });

  // A "skip" is a jump of more than one level (h2 → h4), which breaks the outline
  // engines use to decide what a section answers.
  let headingSkips = 0;
  for (let i = 1; i < headingOutline.length; i += 1) {
    const prev = headingOutline[i - 1]!;
    const cur = headingOutline[i]!;
    if (cur.level - prev.level > 1) headingSkips += 1;
  }

  const questionHeadings = headingOutline.filter((h) =>
    /^(who|what|when|where|why|how|which|can|do|does|is|are|should|will)\b/i.test(h.text) ||
    h.text.trim().endsWith('?'),
  ).length;

  // ── JSON-LD ─────────────────────────────────────────────────────────────
  const blocks: JsonLdBlock[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      const types = new Set<string>();
      const sameAs = new Set<string>();
      collectJsonLd(parsed, types, sameAs);
      blocks.push({ valid: types.size > 0, types: [...types], sameAs: [...sameAs], raw });
    } catch {
      blocks.push({ valid: false, types: [], sameAs: [], raw });
    }
  });

  const jsonldTypes = [...new Set(blocks.flatMap((b) => b.types))];
  const sameAs = [...new Set(blocks.flatMap((b) => b.sameAs))];
  const hasFaqSchema = jsonldTypes.some((t) => /^(FAQPage|QAPage)$/i.test(t));

  // ── FAQ / answerability ─────────────────────────────────────────────────
  const detailsCount = $('details').length;
  const hasFaq =
    hasFaqSchema ||
    detailsCount >= 2 ||
    questionHeadings >= 2 ||
    /\b(frequently asked questions|faqs?)\b/i.test(visibleText.slice(0, 4000));

  // A direct answer = the first substantive paragraph is short and self-contained.
  const firstPara = bodyClone.find('p').first().text().replace(/\s+/g, ' ').trim();
  const firstParaWords = firstPara ? firstPara.split(' ').length : 0;
  const hasDirectAnswer = firstParaWords >= 15 && firstParaWords <= 80;

  // ── JS dependence ───────────────────────────────────────────────────────
  const scriptCount = $('script[src]').length;
  let jsDependent = false;
  let jsDependentReason: string | null = null;

  const spaRootWithNoContent = SPA_ROOTS.some((sel) => {
    const node = $(sel);
    if (!node.length) return false;
    return node.text().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length < 30;
  });

  if (spaRootWithNoContent && wordCount < 200) {
    jsDependent = true;
    jsDependentReason = 'A client-side framework mount point is present but empty in the HTML';
  } else if (wordCount < 120 && scriptCount >= 3) {
    jsDependent = true;
    jsDependentReason = `Only ${wordCount} words in the raw HTML alongside ${scriptCount} scripts`;
  } else if (/\b(enable|turn on) javascript\b/i.test($('noscript').text())) {
    jsDependent = true;
    jsDependentReason = 'A <noscript> block asks the visitor to enable JavaScript';
  } else if (textRatio < 0.03 && wordCount < 300) {
    jsDependent = true;
    jsDependentReason = `Visible text is only ${(textRatio * 100).toFixed(1)}% of the HTML payload`;
  }

  // ── metadata ────────────────────────────────────────────────────────────
  const metaDateModified =
    $('meta[property="article:modified_time"]').attr('content') ??
    $('meta[name="last-modified"]').attr('content') ??
    null;
  const jsonLdDate = findJsonLdString(blocks, ['dateModified', 'datePublished']);
  const author =
    findJsonLdString(blocks, ['author']) ??
    $('meta[name="author"]').attr('content') ??
    $('[rel="author"]').first().text().trim() ??
    null;

  const robotsMeta = ($('meta[name="robots"]').attr('content') ?? '').toLowerCase();

  // ── internal links (crawl frontier) ─────────────────────────────────────
  const internalLinks = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const normalised = normaliseLink(href, pageUrl);
    if (normalised) internalLinks.add(normalised);
  });

  return {
    url: res.finalUrl || res.url,
    depth,
    statusCode: res.statusCode,
    contentType: res.contentType,
    title: $('title').first().text().trim() || null,
    titleLength: $('title').first().text().trim().length,
    metaDescription: $('meta[name="description"]').attr('content')?.trim() ?? null,
    h1: $('h1').first().text().replace(/\s+/g, ' ').trim() || null,
    h1Count: $('h1').length,
    headingOutline: headingOutline.slice(0, 80),
    headingSkips,
    wordCount,
    textRatio: Number(textRatio.toFixed(4)),
    jsDependent,
    jsDependentReason,
    jsonldBlocks: blocks.length,
    jsonldInvalid: blocks.filter((b) => !b.valid).length,
    jsonldTypes,
    sameAs,
    hasFaqSchema,
    hasFaq,
    questionHeadings,
    hasDirectAnswer,
    listCount: $('ul, ol').length,
    tableCount: $('table').length,
    dateModified: jsonLdDate ?? metaDateModified,
    author: author || null,
    canonical: $('link[rel="canonical"]').attr('href') ?? null,
    noindex: /\bnoindex\b/.test(robotsMeta),
    internalLinks: [...internalLinks].slice(0, 300),
  };
}

/** Walk arbitrary JSON-LD, collecting @type values and sameAs links. */
function collectJsonLd(node: unknown, types: Set<string>, sameAs: Set<string>, depth = 0): void {
  if (depth > 12 || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) collectJsonLd(item, types, sameAs, depth + 1);
    return;
  }

  const obj = node as Record<string, unknown>;
  const t = obj['@type'];
  if (typeof t === 'string') types.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') types.add(x);

  const sa = obj['sameAs'];
  if (typeof sa === 'string') sameAs.add(sa);
  else if (Array.isArray(sa)) for (const x of sa) if (typeof x === 'string') sameAs.add(x);

  for (const value of Object.values(obj)) collectJsonLd(value, types, sameAs, depth + 1);
}

/** First string value found at any of `keys` anywhere in the parsed JSON-LD. */
function findJsonLdString(blocks: JsonLdBlock[], keys: string[]): string | null {
  for (const block of blocks) {
    if (!block.raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.raw);
    } catch {
      continue;
    }
    const found = search(parsed, 0);
    if (found) return found;
  }
  return null;

  function search(node: unknown, depth: number): string | null {
    if (depth > 10 || node === null || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const r = search(item, depth + 1);
        if (r) return r;
      }
      return null;
    }
    const obj = node as Record<string, unknown>;
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v === 'object') {
        const name = (v as Record<string, unknown>)['name'];
        if (typeof name === 'string' && name.trim()) return name.trim();
      }
    }
    for (const v of Object.values(obj)) {
      const r = search(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
}

/**
 * Resolve a href against the page, keep it only if same-origin and crawlable,
 * and strip the fragment and common tracking params so the frontier dedupes.
 */
export function normaliseLink(href: string, base: URL): string | null {
  if (/^(mailto|tel|javascript|data|sms|ftp):/i.test(href.trim())) return null;
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.host !== base.host) return null;
  if (/\.(jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|pdf|zip|gz|mp4|mp3|woff2?|ttf|eot)$/i.test(url.pathname)) {
    return null;
  }
  url.hash = '';
  for (const p of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|msclkid|ref|mc_cid|mc_eid)/i.test(p)) url.searchParams.delete(p);
  }
  // Treat /path and /path/ as the same page.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}
