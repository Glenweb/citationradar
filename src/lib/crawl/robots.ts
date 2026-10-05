/**
 * robots.txt parsing, used for two distinct purposes:
 *
 *  1. Politeness — may *we* fetch a given path (our own user-agent)?
 *  2. Scoring   — can the AI crawlers fetch the site at all? This is the single
 *     highest-weighted signal in the AEO score, because a blocked GPTBot makes
 *     every other optimisation irrelevant.
 *
 * Implements the REP rules that matter here: group merging by user-agent, the most
 * specific matching group wins, `*` and `$` wildcards, and longest-match precedence
 * between Allow and Disallow with Allow winning a tie.
 */

export type RobotsRule = { type: 'allow' | 'disallow'; path: string };
export type RobotsGroup = { agents: string[]; rules: RobotsRule[]; crawlDelay?: number };

export type RobotsTxt = {
  fetched: boolean;
  statusCode: number | null;
  /** True when robots.txt is absent or 4xx — which means "everything allowed". */
  permissiveByAbsence: boolean;
  groups: RobotsGroup[];
  sitemaps: string[];
  raw: string;
};

/** The crawlers that matter for AI answer surfaces. */
export const AI_AGENTS = [
  { ua: 'GPTBot', label: 'GPTBot', vendor: 'OpenAI', purpose: 'ChatGPT training + browsing' },
  { ua: 'OAI-SearchBot', label: 'OAI-SearchBot', vendor: 'OpenAI', purpose: 'ChatGPT search index' },
  { ua: 'ClaudeBot', label: 'ClaudeBot', vendor: 'Anthropic', purpose: 'Claude citations' },
  { ua: 'PerplexityBot', label: 'PerplexityBot', vendor: 'Perplexity', purpose: 'Perplexity answers' },
  { ua: 'Google-Extended', label: 'Google-Extended', vendor: 'Google', purpose: 'Gemini / AI Overviews grounding' },
  { ua: 'CCBot', label: 'CCBot', vendor: 'Common Crawl', purpose: 'Open training corpus' },
] as const;

export type AiAgentUa = (typeof AI_AGENTS)[number]['ua'];

export function parseRobots(raw: string, statusCode: number | null): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastLineWasAgent = false;

  for (const line of raw.split(/\r?\n/)) {
    const stripped = line.split('#')[0]?.trim() ?? '';
    if (!stripped) continue;
    const idx = stripped.indexOf(':');
    if (idx === -1) continue;

    const field = stripped.slice(0, idx).trim().toLowerCase();
    const value = stripped.slice(idx + 1).trim();
    if (!value && field !== 'disallow') continue;

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;

    if (field === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (!current) continue;

    if (field === 'allow') {
      current.rules.push({ type: 'allow', path: value });
    } else if (field === 'disallow') {
      // `Disallow:` with an empty value means "allow everything" — not a rule.
      if (value) current.rules.push({ type: 'disallow', path: value });
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  return {
    fetched: statusCode !== null,
    statusCode,
    permissiveByAbsence:
      statusCode === null || statusCode === 404 || statusCode === 410 || statusCode === 403,
    groups,
    sitemaps,
    raw,
  };
}

/** Pick the group whose user-agent token best matches `ua` (longest match, then `*`). */
function groupFor(robots: RobotsTxt, ua: string): RobotsGroup | null {
  const needle = ua.toLowerCase();
  let best: { group: RobotsGroup; len: number } | null = null;
  let wildcard: RobotsGroup | null = null;

  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === '*') {
        if (!wildcard) wildcard = group;
        continue;
      }
      if (needle.startsWith(agent) || needle === agent) {
        if (!best || agent.length > best.len) best = { group, len: agent.length };
      }
    }
  }
  return best?.group ?? wildcard;
}

/** Translate a robots path pattern (with * and $) into a regex. */
function patternToRegex(pattern: string): RegExp {
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === '*') {
      out += '.*';
    } else if (ch === '$' && i === pattern.length - 1) {
      out += '$';
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(out);
}

/**
 * Is `path` crawlable by `ua`? Longest matching rule wins; Allow beats Disallow on ties
 * (per Google's and OpenAI's stated behaviour).
 */
export function isAllowed(robots: RobotsTxt, ua: string, path: string): boolean {
  if (robots.permissiveByAbsence && robots.groups.length === 0) return true;
  const group = groupFor(robots, ua);
  if (!group) return true;

  let decision = true;
  let bestLen = -1;

  for (const rule of group.rules) {
    if (!patternToRegex(rule.path).test(path)) continue;
    const len = rule.path.length;
    if (len > bestLen || (len === bestLen && rule.type === 'allow')) {
      bestLen = len;
      decision = rule.type === 'allow';
    }
  }
  return decision;
}

export type AiAccess = {
  ua: string;
  label: string;
  vendor: string;
  purpose: string;
  /** Can this bot fetch the site root? */
  allowed: boolean;
  /** Blocked by a rule naming this bot specifically, rather than by `User-agent: *`. */
  explicitlyBlocked: boolean;
  /** Named in robots.txt at all (even to allow it). */
  mentioned: boolean;
};

/** Access matrix for every AI crawler we score against. */
export function aiAccessMatrix(robots: RobotsTxt): AiAccess[] {
  return AI_AGENTS.map((agent) => {
    const needle = agent.ua.toLowerCase();
    const mentioned = robots.groups.some((g) =>
      g.agents.some((a) => a !== '*' && (needle.startsWith(a) || needle === a)),
    );
    const allowed = isAllowed(robots, agent.ua, '/');
    return {
      ua: agent.ua,
      label: agent.label,
      vendor: agent.vendor,
      purpose: agent.purpose,
      allowed,
      explicitlyBlocked: !allowed && mentioned,
      mentioned,
    };
  });
}

/** Does `User-agent: *` disallow the whole site? */
export function blocksEveryone(robots: RobotsTxt): boolean {
  const wildcard = robots.groups.find((g) => g.agents.includes('*'));
  if (!wildcard) return false;
  return wildcard.rules.some((r) => r.type === 'disallow' && (r.path === '/' || r.path === '/*'));
}
