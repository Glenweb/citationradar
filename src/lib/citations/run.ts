import 'server-only';
import { sql, sqlOne } from '../db';
import { enginesForPlan, type EngineId, type PlanId } from '../billing/plans';
import { incrementUsage } from '../billing/usage';
import { checkPrompt } from './index';
import type { CitationQuery, CitationResult, CompetitorRef } from './types';

export type PromptRow = {
  id: string;
  workspace_id: string;
  site_id: string;
  prompt: string;
  intent: string | null;
  locale: string;
  engines: string[];
  is_active: boolean;
  last_checked_at: string | null;
};

export type CheckRow = {
  id: string;
  prompt_id: string;
  engine: EngineId;
  mode: 'live' | 'simulated';
  brand_cited: boolean;
  brand_position: number | null;
  brand_mentions: number;
  domain_linked: boolean;
  share_of_voice: string;
  citation_urls: unknown;
  competitor_mentions: unknown;
  response_excerpt: string | null;
  sentiment: string | null;
  error: string | null;
  checked_at: string;
};

/** Build the query for a prompt: brand, aliases, domain and competitor list. */
export async function buildQuery(prompt: PromptRow): Promise<CitationQuery> {
  const site = await sqlOne<{
    domain: string;
    brand_name: string;
    brand_aliases: string[];
  }>`SELECT domain, brand_name, brand_aliases FROM sites WHERE id = ${prompt.site_id}`;
  if (!site) throw new Error('Site not found for prompt.');

  const competitors = await sql<{ name: string; domain: string | null; aliases: string[] }>`
    SELECT name, domain, aliases FROM competitors WHERE site_id = ${prompt.site_id} ORDER BY name
  `;

  return {
    prompt: prompt.prompt,
    brandName: site.brand_name,
    brandAliases: site.brand_aliases ?? [],
    domain: site.domain,
    competitors: competitors.map(
      (c): CompetitorRef => ({ name: c.name, domain: c.domain, aliases: c.aliases ?? [] }),
    ),
    locale: prompt.locale,
  };
}

/**
 * Run one prompt across the engines it tracks (capped by plan) and append one row per
 * engine. Rows are written even when an engine errored, so a gap in the chart always
 * has a reason attached rather than silently disappearing.
 */
export async function runPromptCheck(
  prompt: PromptRow,
  plan: PlanId,
  triggerSource: 'manual' | 'schedule' | 'seed' = 'manual',
): Promise<CitationResult[]> {
  const query = await buildQuery(prompt);
  const allowed = new Set(enginesForPlan(plan));
  const engines = (prompt.engines as EngineId[]).filter((e) => allowed.has(e));

  if (!engines.length) return [];

  const results = await checkPrompt(query, engines);

  for (const r of results) {
    await sql`
      INSERT INTO citation_checks (
        workspace_id, site_id, prompt_id, engine, mode, brand_cited, brand_position,
        brand_mentions, domain_linked, share_of_voice, citation_urls,
        competitor_mentions, response_excerpt, sentiment, latency_ms, error, trigger_source
      ) VALUES (
        ${prompt.workspace_id}, ${prompt.site_id}, ${prompt.id}, ${r.engine}, ${r.mode},
        ${r.brandCited}, ${r.brandPosition}, ${r.brandMentions}, ${r.domainLinked},
        ${r.shareOfVoice}, ${JSON.stringify(r.citationUrls)}::jsonb,
        ${JSON.stringify(r.competitorMentions)}::jsonb, ${r.responseExcerpt},
        ${r.sentiment}, ${r.latencyMs}, ${r.error ?? null}, ${triggerSource}
      )
    `;
  }

  await sql`UPDATE tracked_prompts SET last_checked_at = now() WHERE id = ${prompt.id}`;
  await incrementUsage(prompt.workspace_id, 'citation_checks', results.length);

  return results;
}

/** Latest check per (prompt, engine) — the current state of the tracker. */
export async function latestChecks(siteId: string) {
  return sql<CheckRow & { prompt: string; intent: string | null }>`
    SELECT DISTINCT ON (c.prompt_id, c.engine)
      c.*, p.prompt, p.intent
    FROM citation_checks c
    JOIN tracked_prompts p ON p.id = c.prompt_id
    WHERE c.site_id = ${siteId}
    ORDER BY c.prompt_id, c.engine, c.checked_at DESC
  `;
}

/**
 * Visibility history: per day, the share of (prompt × engine) checks that cited the
 * brand, and the mean share of voice. This is the chart on the tracker page.
 */
export async function visibilityHistory(siteId: string, days = 90) {
  return sql<{
    day: string;
    engine: EngineId;
    checks: number;
    cited: number;
    visibility: string;
    avg_sov: string;
  }>`
    SELECT
      to_char(date_trunc('day', checked_at), 'YYYY-MM-DD') AS day,
      engine,
      count(*)::int AS checks,
      count(*) FILTER (WHERE brand_cited)::int AS cited,
      round(avg(CASE WHEN brand_cited THEN 1.0 ELSE 0.0 END) * 100, 1) AS visibility,
      round(avg(share_of_voice) * 100, 1) AS avg_sov
    FROM citation_checks
    WHERE site_id = ${siteId}
      AND checked_at > now() - (${days} || ' days')::interval
      AND error IS NULL
    GROUP BY 1, 2
    ORDER BY 1 ASC, 2 ASC
  `;
}

/** Overall current visibility for a site, across all engines. */
export async function currentVisibility(siteId: string) {
  return sqlOne<{
    checks: number;
    cited: number;
    visibility: string;
    avg_sov: string;
    simulated: number;
  }>`
    WITH latest AS (
      SELECT DISTINCT ON (prompt_id, engine) *
      FROM citation_checks
      WHERE site_id = ${siteId} AND error IS NULL
      ORDER BY prompt_id, engine, checked_at DESC
    )
    SELECT
      count(*)::int AS checks,
      count(*) FILTER (WHERE brand_cited)::int AS cited,
      coalesce(round(avg(CASE WHEN brand_cited THEN 1.0 ELSE 0.0 END) * 100, 1), 0) AS visibility,
      coalesce(round(avg(share_of_voice) * 100, 1), 0) AS avg_sov,
      count(*) FILTER (WHERE mode = 'simulated')::int AS simulated
    FROM latest
  `;
}

/**
 * Competitor share-of-voice benchmark. Expands the competitor_mentions JSON of the most
 * recent check per (prompt, engine) so brand and competitors are ranked on one scale.
 */
export async function competitorBenchmark(siteId: string) {
  return sql<{
    name: string;
    is_brand: boolean;
    mentions: number;
    appearances: number;
    total_checks: number;
    presence: string;
  }>`
    WITH latest AS (
      SELECT DISTINCT ON (prompt_id, engine) *
      FROM citation_checks
      WHERE site_id = ${siteId} AND error IS NULL
      ORDER BY prompt_id, engine, checked_at DESC
    ),
    total AS (SELECT count(*)::int AS n FROM latest),
    brand AS (
      SELECT
        (SELECT brand_name FROM sites WHERE id = ${siteId}) AS name,
        true AS is_brand,
        coalesce(sum(brand_mentions), 0)::int AS mentions,
        count(*) FILTER (WHERE brand_cited)::int AS appearances
      FROM latest
    ),
    comps AS (
      SELECT
        m->>'name' AS name,
        false AS is_brand,
        coalesce(sum((m->>'mentions')::int), 0)::int AS mentions,
        count(*) FILTER (WHERE (m->>'mentions')::int > 0)::int AS appearances
      FROM latest, jsonb_array_elements(competitor_mentions) AS m
      GROUP BY 1
    )
    SELECT r.name, r.is_brand, r.mentions, r.appearances,
           (SELECT n FROM total) AS total_checks,
           CASE WHEN (SELECT n FROM total) > 0
                THEN round(r.appearances::numeric / (SELECT n FROM total) * 100, 1)
                ELSE 0 END AS presence
    FROM (SELECT * FROM brand UNION ALL SELECT * FROM comps) r
    WHERE r.name IS NOT NULL
    ORDER BY r.mentions DESC, r.appearances DESC
  `;
}

/** Full history for one prompt, for the detail drawer. */
export async function promptHistory(promptId: string, limit = 60) {
  return sql<CheckRow>`
    SELECT * FROM citation_checks
    WHERE prompt_id = ${promptId}
    ORDER BY checked_at DESC
    LIMIT ${limit}
  `;
}
