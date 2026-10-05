import 'server-only';
import { assertSafeUrl, fetchPage, fetchText } from './fetcher';
import { analysePage, normaliseLink, type PageAnalysis } from './analyse';
import { aiAccessMatrix, isAllowed, parseRobots, type AiAccess, type RobotsTxt } from './robots';
import { env } from '../env';

export type AnswerSurface = {
  llmsTxt: { present: boolean; bytes: number; wellFormed: boolean; sections: number };
  llmsFullTxt: { present: boolean; bytes: number };
  sitemap: { present: boolean; urlCount: number; source: 'robots' | 'default' | null };
};

export type CrawlOutcome = {
  origin: string;
  robots: RobotsTxt;
  aiAccess: AiAccess[];
  answerSurface: AnswerSurface;
  pages: PageAnalysis[];
  capped: boolean;
  skippedByRobots: number;
  durationMs: number;
};

const CONCURRENCY = 4;
const POLITENESS_MS = 300;

/**
 * Same-origin breadth-first crawl, honouring robots.txt for our own user-agent and
 * stopping at `maxPages`. Breadth-first (rather than depth-first) because the pages
 * nearest the home page are the ones AI engines are most likely to surface.
 */
export async function crawlSite(
  startUrl: string,
  maxPages: number,
): Promise<CrawlOutcome> {
  const started = Date.now();
  const start = await assertSafeUrl(startUrl);
  const origin = start.origin;
  const ua = env.crawlUserAgent().split('/')[0] ?? 'CitationRadarBot';
  const cap = Math.max(1, Math.min(maxPages, env.crawlHardCap()));

  const robots = await fetchRobots(origin);
  const answerSurface = await fetchAnswerSurface(origin, robots);

  const seedPath = start.pathname + start.search;
  const frontier: { url: string; depth: number }[] = [
    { url: normaliseLink(start.toString(), start) ?? start.toString(), depth: 0 },
  ];
  const seen = new Set(frontier.map((f) => f.url));
  const pages: PageAnalysis[] = [];
  let skippedByRobots = 0;
  let capped = false;

  // Honour robots for the seed too, but never silently return nothing: if the seed
  // itself is disallowed for us, report it as a crawl outcome rather than an empty one.
  if (!isAllowed(robots, ua, seedPath)) {
    return {
      origin,
      robots,
      aiAccess: aiAccessMatrix(robots),
      answerSurface,
      pages: [
        {
          ...emptyAnalysis(start.toString()),
          error: `robots.txt disallows ${ua} from ${seedPath}`,
        },
      ],
      capped: false,
      skippedByRobots: 1,
      durationMs: Date.now() - started,
    };
  }

  while (frontier.length && pages.length < cap) {
    const batch = frontier.splice(0, Math.min(CONCURRENCY, cap - pages.length));

    const results = await Promise.all(
      batch.map(async (item) => {
        const res = await fetchPage(item.url);
        return analysePage(res, item.depth);
      }),
    );

    for (const analysis of results) {
      pages.push(analysis);

      // Only expand the frontier from pages that actually rendered content.
      if (analysis.error || pages.length >= cap) continue;
      for (const link of analysis.internalLinks) {
        if (seen.has(link)) continue;
        let path: string;
        try {
          const u = new URL(link);
          if (u.origin !== origin) continue;
          path = u.pathname + u.search;
        } catch {
          continue;
        }
        if (!isAllowed(robots, ua, path)) {
          skippedByRobots += 1;
          seen.add(link);
          continue;
        }
        seen.add(link);
        frontier.push({ url: link, depth: analysis.depth + 1 });
      }
    }

    if (frontier.length && pages.length >= cap) capped = true;
    if (frontier.length) await sleep(POLITENESS_MS);
  }

  return {
    origin,
    robots,
    aiAccess: aiAccessMatrix(robots),
    answerSurface,
    pages,
    capped,
    skippedByRobots,
    durationMs: Date.now() - started,
  };
}

/** Audit a single URL (the free audit path): one page + robots + answer surface. */
export async function crawlSingleUrl(targetUrl: string): Promise<CrawlOutcome> {
  const started = Date.now();
  const url = await assertSafeUrl(targetUrl);
  const [robots, res] = await Promise.all([
    fetchRobots(url.origin),
    fetchPage(url.toString()),
  ]);
  const answerSurface = await fetchAnswerSurface(url.origin, robots);

  return {
    origin: url.origin,
    robots,
    aiAccess: aiAccessMatrix(robots),
    answerSurface,
    pages: [analysePage(res, 0)],
    capped: false,
    skippedByRobots: 0,
    durationMs: Date.now() - started,
  };
}

export async function fetchRobots(origin: string): Promise<RobotsTxt> {
  const res = await fetchText(`${origin}/robots.txt`);
  if (res.error || res.statusCode === null) return parseRobots('', null);
  if (res.statusCode >= 400) return parseRobots('', res.statusCode);
  // Some hosts serve an HTML 404 page with a 200 status; that isn't a robots.txt.
  if (/^\s*</.test(res.body)) return parseRobots('', 404);
  return parseRobots(res.body, res.statusCode);
}

/**
 * The "answer surface": the files that exist specifically to tell an LLM what a site
 * is and where to look — llms.txt, llms-full.txt and the sitemap.
 */
export async function fetchAnswerSurface(
  origin: string,
  robots: RobotsTxt,
): Promise<AnswerSurface> {
  const [llms, llmsFull] = await Promise.all([
    fetchText(`${origin}/llms.txt`),
    fetchText(`${origin}/llms-full.txt`),
  ]);

  const llmsOk = !!llms.statusCode && llms.statusCode < 400 && !/^\s*</.test(llms.body);
  // A well-formed llms.txt opens with an H1 and lists links under H2 sections.
  const wellFormed = llmsOk && /^#\s+\S/m.test(llms.body) && /\[.+\]\(.+\)/.test(llms.body);
  const sections = llmsOk ? (llms.body.match(/^##\s+\S/gm) ?? []).length : 0;

  const sitemapUrl = robots.sitemaps[0] ?? `${origin}/sitemap.xml`;
  const sitemapRes = await fetchText(sitemapUrl);
  const sitemapOk =
    !!sitemapRes.statusCode && sitemapRes.statusCode < 400 && /<(urlset|sitemapindex)/i.test(sitemapRes.body);

  return {
    llmsTxt: {
      present: llmsOk,
      bytes: llmsOk ? llms.bytes : 0,
      wellFormed,
      sections,
    },
    llmsFullTxt: {
      present:
        !!llmsFull.statusCode && llmsFull.statusCode < 400 && !/^\s*</.test(llmsFull.body),
      bytes: llmsFull.bytes,
    },
    sitemap: {
      present: sitemapOk,
      urlCount: sitemapOk ? (sitemapRes.body.match(/<loc>/gi) ?? []).length : 0,
      source: sitemapOk ? (robots.sitemaps.length ? 'robots' : 'default') : null,
    },
  };
}

function emptyAnalysis(url: string): PageAnalysis {
  return {
    url,
    depth: 0,
    statusCode: null,
    contentType: null,
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
