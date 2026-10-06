import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql, sqlOne } from '../db';
import { crawlSingleUrl, crawlSite, type CrawlOutcome } from '../crawl/crawler';
import { UnsafeUrlError, assertSafeUrl } from '../crawl/fetcher';
import { deriveIssues, type Issue } from './issues';
import { recommend, type Recommendation } from './recommend';
import { scoreCrawl, type AeoScore } from './score';
import { SiteUnreachableError } from '../errors';

export type AuditRecord = {
  id: string;
  public_id: string;
  workspace_id: string | null;
  site_id: string | null;
  scope: 'site' | 'single_url';
  target_url: string;
  origin: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  overall_score: number | null;
  previous_score: number | null;
  grade: string | null;
  pillar_scores: unknown;
  robots: unknown;
  answer_surface: unknown;
  pages_crawled: number;
  pages_capped: boolean;
  summary: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
};

/**
 * Refuse to produce a score when not one page came back.
 *
 * Without this the audit still "completed": robots.txt and llms.txt are absent on a site
 * we never reached, those checks score zero, and the report publishes a plausible-looking
 * number — 45/100, grade E — for a site that was never actually fetched. A score the user
 * reads as their own, derived from a page we never saw, is worse than no score at all, so
 * the audit fails with the reason instead.
 */
export function assertSomethingWasFetched(outcome: CrawlOutcome, targetUrl: string): void {
  const usable = outcome.pages.filter((p) => !p.error && (p.statusCode ?? 0) < 400);
  if (usable.length > 0) return;

  const first = outcome.pages[0];
  const host = safeHost(targetUrl);

  if (first?.statusCode && first.statusCode >= 400) {
    throw new SiteUnreachableError(
      `${host} returned HTTP ${first.statusCode} to our crawler, so there was no page to analyse. ` +
        `If the site loads fine in a browser, it is likely blocking unknown crawlers — which ` +
        `means GPTBot, ClaudeBot and PerplexityBot are being turned away in exactly the same way.`,
    );
  }

  const reason = first?.error ?? 'the request failed';
  throw new SiteUnreachableError(
    `We could not fetch ${host} (${reason}). Check the address is right and the site is ` +
      `reachable over HTTPS from outside your network. Bot-protection services and firewalls ` +
      `often refuse unknown crawlers, and the AI crawlers hit the same wall.`,
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export { SiteUnreachableError };

export function newPublicId(): string {
  return randomBytes(8).toString('base64url');
}

/** Normalise user input ("example.com", "example.com/page") into an absolute URL. */
export function normaliseTarget(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new UnsafeUrlError('Enter a URL to audit.');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export type StartAuditInput = {
  targetUrl: string;
  scope: 'site' | 'single_url';
  maxPages: number;
  workspaceId?: string | null;
  siteId?: string | null;
  brandName?: string;
  ip?: string | null;
};

/** Insert the audit row, then run it. Returns the finished record. */
export async function startAudit(input: StartAuditInput): Promise<AuditRecord> {
  const target = normaliseTarget(input.targetUrl);
  const url = await assertSafeUrl(target);
  const publicId = newPublicId();

  // Carry the previous score forward so the report can show movement.
  const previous = input.siteId
    ? await sqlOne<{ overall_score: number }>`
        SELECT overall_score FROM audits
        WHERE site_id = ${input.siteId} AND status = 'complete' AND overall_score IS NOT NULL
        ORDER BY completed_at DESC LIMIT 1
      `
    : null;

  const created = await sqlOne<AuditRecord>`
    INSERT INTO audits (
      workspace_id, site_id, public_id, scope, target_url, origin,
      status, previous_score, created_ip
    ) VALUES (
      ${input.workspaceId ?? null}, ${input.siteId ?? null}, ${publicId}, ${input.scope},
      ${url.toString()}, ${url.origin}, 'running', ${previous?.overall_score ?? null},
      ${input.ip ?? null}
    )
    RETURNING *
  `;
  if (!created) throw new Error('Could not create the audit record.');

  return runAudit(created.id, {
    scope: input.scope,
    targetUrl: url.toString(),
    maxPages: input.maxPages,
    brandName: input.brandName ?? url.host,
    workspaceId: input.workspaceId ?? null,
  });
}

/** Execute a queued/running audit: crawl, score, derive issues, persist. */
export async function runAudit(
  auditId: string,
  opts: {
    scope: 'site' | 'single_url';
    targetUrl: string;
    maxPages: number;
    brandName: string;
    workspaceId: string | null;
  },
): Promise<AuditRecord> {
  const started = Date.now();

  try {
    const outcome: CrawlOutcome =
      opts.scope === 'single_url'
        ? await crawlSingleUrl(opts.targetUrl)
        : await crawlSite(opts.targetUrl, opts.maxPages);

    assertSomethingWasFetched(outcome, opts.targetUrl);

    const score = scoreCrawl(outcome, opts.brandName);
    const issues = deriveIssues(score);
    const rec = await recommend(score, issues, {
      origin: outcome.origin,
      brandName: opts.brandName,
      pagesCrawled: outcome.pages.length,
    });

    await persistPages(auditId, outcome);
    await persistIssues(auditId, opts.workspaceId, issues, rec);

    const updated = await sqlOne<AuditRecord>`
      UPDATE audits SET
        status = 'complete',
        overall_score = ${score.overall},
        grade = ${score.grade},
        pillar_scores = ${JSON.stringify(serialisePillars(score))}::jsonb,
        robots = ${JSON.stringify({
          statusCode: outcome.robots.statusCode,
          sitemaps: outcome.robots.sitemaps,
          aiAccess: outcome.aiAccess,
        })}::jsonb,
        answer_surface = ${JSON.stringify(outcome.answerSurface)}::jsonb,
        pages_crawled = ${outcome.pages.length},
        pages_capped = ${outcome.capped},
        summary = ${rec.executiveSummary},
        completed_at = now(),
        duration_ms = ${Date.now() - started}
      WHERE id = ${auditId}
      RETURNING *
    `;
    if (!updated) throw new Error('Audit row vanished mid-run.');
    return updated;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const failed = await sqlOne<AuditRecord>`
      UPDATE audits SET
        status = 'failed', error = ${message},
        completed_at = now(), duration_ms = ${Date.now() - started}
      WHERE id = ${auditId}
      RETURNING *
    `;
    if (failed) return failed;
    throw e;
  }
}

/** The pillar shape stored on the audit row and read back by the report UI. */
export function serialisePillars(score: AeoScore) {
  return {
    overall: score.overall,
    rawOverall: score.rawOverall,
    ceiling: score.ceiling,
    grade: score.grade,
    summary: score.summary,
    pillars: score.pillars.map((p) => ({
      id: p.id,
      label: p.label,
      weight: p.weight,
      score: p.score,
      points: p.points,
      checks: p.checks.map((c) => ({
        code: c.code,
        label: c.label,
        score: c.score,
        weight: c.weight,
        passed: c.passed,
        detail: c.detail,
      })),
    })),
  };
}

export type StoredPillars = ReturnType<typeof serialisePillars>;

async function persistPages(auditId: string, outcome: CrawlOutcome): Promise<void> {
  for (const page of outcome.pages) {
    await sql`
      INSERT INTO audit_pages (
        audit_id, url, depth, status_code, content_type, title, meta_description,
        h1, h1_count, heading_outline, heading_skips, word_count, text_ratio,
        js_dependent, jsonld_blocks, jsonld_invalid, jsonld_types, has_faq,
        question_headings, list_count, table_count, same_as, date_modified, author, issues
      ) VALUES (
        ${auditId}, ${page.url}, ${page.depth}, ${page.statusCode}, ${page.contentType},
        ${page.title}, ${page.metaDescription}, ${page.h1}, ${page.h1Count},
        ${JSON.stringify(page.headingOutline)}::jsonb, ${page.headingSkips},
        ${page.wordCount}, ${page.textRatio}, ${page.jsDependent}, ${page.jsonldBlocks},
        ${page.jsonldInvalid}, ${page.jsonldTypes}, ${page.hasFaq}, ${page.questionHeadings},
        ${page.listCount}, ${page.tableCount}, ${page.sameAs}, ${page.dateModified},
        ${page.author}, ${page.error ? [page.error] : []}
      )
      ON CONFLICT (audit_id, url) DO NOTHING
    `;
  }
}

async function persistIssues(
  auditId: string,
  workspaceId: string | null,
  issues: Issue[],
  rec: Recommendation,
): Promise<void> {
  for (const issue of issues) {
    const tailored = rec.tailored[issue.code];
    await sql`
      INSERT INTO audit_issues (
        audit_id, workspace_id, code, pillar, severity, effort, title,
        what_it_means, why_it_matters, how_to_fix, code_snippet,
        impact_points, priority_score, affected_count, affected_sample,
        evidence, ai_generated
      ) VALUES (
        ${auditId}, ${workspaceId}, ${issue.code}, ${issue.pillar}, ${issue.severity},
        ${issue.effort}, ${issue.title},
        ${tailored ? `${issue.whatItMeans}\n\n${tailored}` : issue.whatItMeans},
        ${issue.whyItMatters}, ${issue.howToFix}, ${issue.codeSnippet},
        ${issue.impactPoints}, ${issue.priorityScore}, ${issue.affectedCount},
        ${issue.affectedSample}, ${JSON.stringify(issue.evidence)}::jsonb,
        ${!!tailored}
      )
    `;
  }

  if (rec.actionPlan.length) {
    await sql`
      UPDATE audits
      SET pillar_scores = jsonb_set(
        pillar_scores, '{actionPlan}', ${JSON.stringify(rec.actionPlan)}::jsonb, true
      )
      WHERE id = ${auditId}
    `;
  }
}

export async function getAuditByPublicId(publicId: string): Promise<AuditRecord | null> {
  return sqlOne<AuditRecord>`SELECT * FROM audits WHERE public_id = ${publicId}`;
}

export async function getAuditIssues(auditId: string) {
  return sql<{
    id: string;
    code: string;
    pillar: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    title: string;
    what_it_means: string;
    why_it_matters: string;
    how_to_fix: string;
    code_snippet: string | null;
    impact_points: string;
    priority_score: string;
    affected_count: number;
    affected_sample: string[];
    evidence: Record<string, unknown>;
    status: string;
  }>`
    SELECT * FROM audit_issues
    WHERE audit_id = ${auditId}
    ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
        = 0 DESC,
      priority_score DESC
  `;
}

export async function getAuditPages(auditId: string) {
  return sql<{
    url: string;
    status_code: number | null;
    title: string | null;
    word_count: number;
    h1_count: number;
    js_dependent: boolean;
    jsonld_blocks: number;
    jsonld_invalid: number;
    has_faq: boolean;
    heading_skips: number;
    issues: string[];
  }>`
    SELECT url, status_code, title, word_count, h1_count, js_dependent,
           jsonld_blocks, jsonld_invalid, has_faq, heading_skips, issues
    FROM audit_pages WHERE audit_id = ${auditId}
    ORDER BY depth ASC, url ASC
  `;
}

/** Anonymous free audits are rate-limited per IP per day. */
export async function freeAuditsToday(ip: string): Promise<number> {
  const row = await sqlOne<{ n: number }>`
    SELECT count(*)::int AS n FROM audits
    WHERE created_ip = ${ip} AND workspace_id IS NULL
      AND started_at > now() - interval '24 hours'
  `;
  return Number(row?.n ?? 0);
}
