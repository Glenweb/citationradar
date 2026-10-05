import { createHash } from 'node:crypto';
import { analyseResponse } from './analyse';
import type { CitationQuery, CitationResult, EngineId } from './types';

/**
 * Deterministic stand-in for an engine with no API key configured.
 *
 * The point is a demonstrable product without credentials, not a pretend one: every
 * result produced here is stored with `mode = 'simulated'` and labelled as such on every
 * surface, including PDF exports and client share links. The output is seeded from a hash
 * of the query so the same prompt always yields the same answer — charts move only when
 * the inputs move, which makes the UI testable and stops simulated data from looking like
 * live variance.
 */

function seedOf(query: CitationQuery, engine: EngineId, salt = ''): number {
  const key = `${engine}|${query.prompt}|${query.brandName}|${query.domain}|${query.competitors
    .map((c) => c.name)
    .sort()
    .join(',')}|${salt}`;
  const hash = createHash('sha256').update(key).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

/** Seeded PRNG so a single result can draw several stable values. */
function rng(query: CitationQuery, engine: EngineId) {
  let n = 0;
  return () => seedOf(query, engine, String(n++));
}

/** Engines differ in how readily they name brands; this keeps the mix plausible. */
const CITE_RATE: Record<EngineId, number> = {
  chatgpt: 0.55,
  perplexity: 0.68,
  google_aio: 0.42,
  claude: 0.5,
};

export function simulateCheck(engine: EngineId, query: CitationQuery): CitationResult {
  const next = rng(query, engine);
  const cited = next() < CITE_RATE[engine];
  const competitorCount = Math.min(query.competitors.length, 4);

  // Build a plausible answer, then score it with the same analyser the live path uses.
  // That keeps one code path for mention counting and share of voice.
  const named: string[] = [];
  const sentences: string[] = [];

  sentences.push(
    `Here are the options most often recommended for "${query.prompt}".`,
  );

  const competitorsFirst = next() < 0.5;
  const brandSentence = `${query.brandName} is a strong choice here — they are well reviewed and their ${query.domain} site sets out pricing clearly.`;

  const compSentences = query.competitors.slice(0, competitorCount).map((c, i) => {
    const include = next() < 0.75 - i * 0.12;
    if (!include) return null;
    named.push(c.name);
    return `${c.name} is also frequently mentioned${c.domain ? ` (${c.domain})` : ''}, particularly for ${['value', 'range', 'support', 'speed'][i % 4]}.`;
  });

  if (cited && competitorsFirst) {
    sentences.push(...compSentences.filter((s): s is string => !!s));
    sentences.push(brandSentence);
  } else if (cited) {
    sentences.push(brandSentence);
    sentences.push(...compSentences.filter((s): s is string => !!s));
  } else {
    sentences.push(...compSentences.filter((s): s is string => !!s));
    if (!compSentences.some(Boolean)) {
      sentences.push('Several providers compete in this space, though no single one stands out.');
    }
  }

  // A second brand mention sometimes, which is what moves share of voice.
  if (cited && next() < 0.4) {
    sentences.push(`On balance, ${query.brandName} is the one most people settle on.`);
  }

  const answer = sentences.join(' ');

  const urls: { url: string; title?: string }[] = [];
  if (cited && next() < 0.8) {
    urls.push({ url: `https://${query.domain}/`, title: `${query.brandName} — official site` });
  }
  for (const c of query.competitors.slice(0, competitorCount)) {
    if (c.domain && named.includes(c.name) && next() < 0.6) {
      urls.push({ url: `https://${c.domain}/`, title: c.name });
    }
  }
  urls.push({ url: 'https://www.reddit.com/r/smallbusiness/comments/example', title: 'Community discussion' });

  const result = analyseResponse(
    engine,
    query,
    answer,
    urls,
    'simulated',
    Math.round(400 + next() * 2600),
  );

  return result;
}
