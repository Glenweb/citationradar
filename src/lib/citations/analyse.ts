import type {
  CitationQuery,
  CitationResult,
  CitationUrl,
  CompetitorMention,
  EngineId,
} from './types';

/** Escape a brand name for use inside a regex. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Count mentions of any of `names` in `text`, matched on word boundaries so that "Apple"
 * does not match "Applebee's" and a two-word brand tolerates a hyphen or extra space.
 *
 * Overlapping matches are counted once. A brand tracked as both "Acme CRM" and the alias
 * "Acme" would otherwise score two mentions for the single phrase "Acme CRM", inflating
 * share of voice against competitors who have no alias. Longer names are matched first so
 * the most specific form wins the span.
 */
export function countMentions(text: string, names: string[]): { count: number; firstIndex: number } {
  const candidates = names
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length);

  const claimed: [number, number][] = [];

  for (const name of candidates) {
    const pattern = escapeRe(name).replace(/\\?\s+/g, '[\\s\\-]+');
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'giu');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (match[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const overlaps = claimed.some(([s, e]) => start < e && end > s);
      if (!overlaps) claimed.push([start, end]);
    }
  }

  if (!claimed.length) return { count: 0, firstIndex: -1 };
  return {
    count: claimed.length,
    firstIndex: Math.min(...claimed.map(([s]) => s)),
  };
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Does `candidate` match `target` as a domain or a subdomain of it? */
export function domainMatches(candidate: string, target: string): boolean {
  const c = candidate.replace(/^www\./i, '').toLowerCase();
  const t = target.replace(/^www\./i, '').toLowerCase();
  if (!c || !t) return false;
  return c === t || c.endsWith(`.${t}`);
}

/**
 * Turn an engine's answer into a scored citation result.
 *
 * Share of voice is the brand's mentions as a fraction of all tracked brands' mentions
 * (brand + competitors). It is the number that belongs in a retainer report: "cited or
 * not" loses the fact that a competitor was named six times and you once.
 */
export function analyseResponse(
  engine: EngineId,
  query: CitationQuery,
  answer: string,
  rawUrls: { url: string; title?: string }[],
  mode: 'live' | 'simulated',
  latencyMs: number,
): CitationResult {
  const brandNames = [query.brandName, ...query.brandAliases].filter(Boolean);
  const brand = countMentions(answer, brandNames);

  const citationUrls: CitationUrl[] = dedupeUrls(rawUrls).map((u) => ({
    url: u.url,
    title: u.title,
    domain: domainOf(u.url),
    isBrand: domainMatches(domainOf(u.url), query.domain),
  }));

  const domainLinked = citationUrls.some((u) => u.isBrand);
  // A linked domain counts as a citation even when the prose does not name the brand —
  // that is still a referral path.
  const brandCited = brand.count > 0 || domainLinked;

  const competitorMentions: CompetitorMention[] = query.competitors.map((c) => {
    const names = [c.name, ...c.aliases].filter(Boolean);
    const found = countMentions(answer, names);
    const linked = c.domain
      ? citationUrls.some((u) => domainMatches(u.domain, c.domain!))
      : false;
    return {
      name: c.name,
      mentions: found.count,
      position: found.firstIndex >= 0 ? found.firstIndex : null,
      linked,
    };
  });

  // Rank brands by where each is first named; the brand's slot in that order is its position.
  const ordered = [
    ...(brand.firstIndex >= 0 ? [{ name: query.brandName, at: brand.firstIndex }] : []),
    ...competitorMentions
      .filter((c) => c.position !== null)
      .map((c) => ({ name: c.name, at: c.position! })),
  ].sort((a, b) => a.at - b.at);

  const brandPosition =
    brand.firstIndex >= 0 ? ordered.findIndex((o) => o.name === query.brandName) + 1 : null;

  const competitorTotal = competitorMentions.reduce((s, c) => s + c.mentions, 0);
  const total = brand.count + competitorTotal;
  const shareOfVoice = total > 0 ? Number((brand.count / total).toFixed(4)) : 0;

  // Re-rank competitor positions from character offsets to 1-based ordinals for display.
  const competitorsRanked = competitorMentions.map((c) => ({
    ...c,
    position: c.position === null ? null : ordered.findIndex((o) => o.name === c.name) + 1,
  }));

  return {
    engine,
    mode,
    brandCited,
    brandPosition,
    brandMentions: brand.count,
    domainLinked,
    shareOfVoice,
    citationUrls: citationUrls.slice(0, 25),
    competitorMentions: competitorsRanked,
    responseExcerpt: excerptAround(answer, brand.firstIndex),
    sentiment: brandCited ? sentimentNear(answer, brand.firstIndex) : null,
    latencyMs,
  };
}

function dedupeUrls(urls: { url: string; title?: string }[]): { url: string; title?: string }[] {
  const seen = new Set<string>();
  const out: { url: string; title?: string }[] = [];
  for (const u of urls) {
    if (!u?.url) continue;
    const key = u.url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

/** A window of the answer around the brand mention — the evidence shown in the UI. */
function excerptAround(text: string, index: number, width = 420): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (index < 0) return clean.slice(0, width);
  const start = Math.max(0, index - Math.floor(width / 3));
  const slice = clean.slice(start, start + width);
  return (start > 0 ? '…' : '') + slice.trim() + (start + width < clean.length ? '…' : '');
}

// Inflected forms are allowed where a suffix cannot create a false positive
// ("strongest" counts, but "top" stays exact so it does not match "topic").
const POSITIVE =
  /\b(?:best|top[- ]rated|leading|recommend(?:s|ed|ation)?|excellent|trust(?:ed|worthy)|popular|strong(?:est|er)?|reliab(?:le|ility)|award[- ]winning|highly[- ]rated|great|standout|well[- ]reviewed|favourite|favorite|solid choice)\b/gi;
const NEGATIVE =
  /\b(?:worst|avoid|poor(?:ly)?|complaint(?:s)?|scam|unreliable|overpriced|expensive|limited|lack(?:s|ing)?|criticis(?:ed|m)|criticiz(?:ed|m)|drawback(?:s)?|downside(?:s)?|outdated|disappoint(?:ing|ed)?)\b/gi;

/**
 * Lexical sentiment in the sentence window around the brand mention. Deliberately
 * coarse: it flags "named unfavourably" for review, it is not a sentiment product.
 */
function sentimentNear(text: string, index: number): 'positive' | 'neutral' | 'negative' {
  const window = index < 0 ? text.slice(0, 600) : text.slice(Math.max(0, index - 250), index + 250);
  const pos = (window.match(POSITIVE) ?? []).length;
  const neg = (window.match(NEGATIVE) ?? []).length;
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

/** Result shape for an engine that errored — recorded, not thrown away. */
export function erroredResult(
  engine: EngineId,
  mode: 'live' | 'simulated',
  message: string,
  latencyMs: number,
): CitationResult {
  return {
    engine,
    mode,
    brandCited: false,
    brandPosition: null,
    brandMentions: 0,
    domainLinked: false,
    shareOfVoice: 0,
    citationUrls: [],
    competitorMentions: [],
    responseExcerpt: '',
    sentiment: null,
    latencyMs,
    error: message,
  };
}
