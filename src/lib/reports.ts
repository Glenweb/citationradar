import 'server-only';
import { sql, sqlOne } from './db';
import { ENGINE_LABELS, planOf, type EngineId, type PlanId } from './billing/plans';
import type { AuditRecord, StoredPillars } from './aeo/run';
import { getAuditIssues } from './aeo/run';
import {
  competitorBenchmark,
  currentVisibility,
  latestChecks,
  visibilityHistory,
} from './citations/run';
import type { AuditReportData, Branding, CitationReportData } from './pdf/report';

export type WorkspaceRow = {
  id: string;
  name: string;
  plan: PlanId;
  brand_name: string | null;
  brand_logo_url: string | null;
  brand_colour: string;
  brand_footer: string | null;
  brand_contact: string | null;
};

/**
 * Branding for an export. White-label is a paid capability, so on plans without it the
 * report carries Citation Radar's own name regardless of what is stored.
 */
export function brandingFor(workspace: WorkspaceRow): Branding {
  const whiteLabel = planOf(workspace.plan).whiteLabel;
  return {
    productName: whiteLabel && workspace.brand_name ? workspace.brand_name : 'Citation Radar',
    brandColour: whiteLabel ? workspace.brand_colour : '#4f46e5',
    footer: whiteLabel ? workspace.brand_footer : null,
    contact: whiteLabel ? workspace.brand_contact : null,
    whiteLabel,
  };
}

export async function loadWorkspace(workspaceId: string): Promise<WorkspaceRow | null> {
  return sqlOne<WorkspaceRow>`
    SELECT id, name, plan, brand_name, brand_logo_url, brand_colour, brand_footer, brand_contact
    FROM workspaces WHERE id = ${workspaceId}
  `;
}

type AiAccessEntry = { label: string; vendor: string; allowed: boolean };

/** Assemble everything the audit PDF and the public share page render. */
export async function buildAuditReportData(auditId: string): Promise<AuditReportData | null> {
  const audit = await sqlOne<
    AuditRecord & { site_name: string | null; site_brand: string | null }
  >`
    SELECT a.*, s.name AS site_name, s.brand_name AS site_brand
    FROM audits a LEFT JOIN sites s ON s.id = a.site_id
    WHERE a.id = ${auditId}
  `;
  if (!audit || audit.status !== 'complete') return null;

  const issues = await getAuditIssues(auditId);
  const stored = (audit.pillar_scores ?? {}) as StoredPillars & {
    actionPlan?: { title: string; detail: string; timeframe: string }[];
  };
  const robots = (audit.robots ?? {}) as { aiAccess?: AiAccessEntry[] };

  return {
    site: {
      name: audit.site_name ?? hostOf(audit.origin),
      origin: audit.origin,
      brandName: audit.site_brand ?? hostOf(audit.origin),
    },
    score: {
      overall: audit.overall_score ?? 0,
      grade: audit.grade ?? '—',
      previous: audit.previous_score,
      summary: audit.summary ?? stored.summary ?? '',
    },
    pillars: (stored.pillars ?? []).map((p) => ({
      label: p.label,
      score: p.score,
      weight: p.weight,
    })),
    aiAccess: (robots.aiAccess ?? []).map((a) => ({
      label: a.label,
      vendor: a.vendor,
      allowed: a.allowed,
    })),
    issues: issues
      .filter((i) => i.status !== 'ignored')
      .map((i) => ({
        title: i.title,
        severity: i.severity,
        effort: i.effort,
        pillarLabel: i.pillar,
        whatItMeans: i.what_it_means,
        whyItMatters: i.why_it_matters,
        howToFix: i.how_to_fix,
        codeSnippet: i.code_snippet,
        impactPoints: Number(i.impact_points),
        priorityScore: Number(i.priority_score),
        affectedCount: i.affected_count,
        affectedSample: i.affected_sample ?? [],
      })),
    actionPlan: stored.actionPlan ?? [],
    pagesCrawled: audit.pages_crawled,
    generatedAt: new Date(),
  };
}

/** Assemble everything the citation PDF and the public share page render. */
export async function buildCitationReportData(siteId: string): Promise<CitationReportData | null> {
  const site = await sqlOne<{ name: string; origin: string; brand_name: string }>`
    SELECT name, origin, brand_name FROM sites WHERE id = ${siteId}
  `;
  if (!site) return null;

  const [visibility, latest, history, benchmark] = await Promise.all([
    currentVisibility(siteId),
    latestChecks(siteId),
    visibilityHistory(siteId, 90),
    competitorBenchmark(siteId),
  ]);

  // Collapse the per-engine daily rows into one visibility figure per day.
  const byDay = new Map<string, { cited: number; checks: number }>();
  for (const row of history) {
    const entry = byDay.get(row.day) ?? { cited: 0, checks: 0 };
    entry.cited += row.cited;
    entry.checks += row.checks;
    byDay.set(row.day, entry);
  }

  const engineTotals = new Map<EngineId, { checks: number; cited: number }>();
  for (const row of latest) {
    const e = engineTotals.get(row.engine) ?? { checks: 0, cited: 0 };
    e.checks += 1;
    if (row.brand_cited) e.cited += 1;
    engineTotals.set(row.engine, e);
  }

  const promptMap = new Map<string, CitationReportData['prompts'][number]>();
  for (const row of latest) {
    const existing = promptMap.get(row.prompt) ?? { prompt: row.prompt, results: [] };
    existing.results.push({
      engine: row.engine,
      cited: row.brand_cited,
      position: row.brand_position,
      sov: Number(row.share_of_voice),
      mode: row.mode,
    });
    promptMap.set(row.prompt, existing);
  }

  return {
    site: { name: site.name, origin: site.origin, brandName: site.brand_name },
    visibility: {
      checks: Number(visibility?.checks ?? 0),
      cited: Number(visibility?.cited ?? 0),
      visibility: Number(visibility?.visibility ?? 0),
      avgSov: Number(visibility?.avg_sov ?? 0),
    },
    anySimulated: latest.some((r) => r.mode === 'simulated'),
    byEngine: [...engineTotals.entries()].map(([engine, v]) => ({
      engine,
      checks: v.checks,
      cited: v.cited,
      visibility: v.checks ? Math.round((v.cited / v.checks) * 1000) / 10 : 0,
    })),
    prompts: [...promptMap.values()],
    benchmark: benchmark.map((b) => ({
      name: b.name,
      isBrand: b.is_brand,
      mentions: b.mentions,
      presence: Number(b.presence),
    })),
    history: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({
        day,
        visibility: v.checks ? Math.round((v.cited / v.checks) * 1000) / 10 : 0,
      })),
    generatedAt: new Date(),
  };
}

export function engineLabel(engine: EngineId): string {
  return ENGINE_LABELS[engine] ?? engine;
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Filename-safe slug for a download. */
export function reportFilename(prefix: string, name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'report';
  return `${prefix}-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

export async function listShareLinks(workspaceId: string) {
  return sql<{
    id: string;
    token: string;
    kind: string;
    label: string | null;
    site_id: string | null;
    audit_id: string | null;
    view_count: number;
    revoked_at: string | null;
    created_at: string;
  }>`
    SELECT id, token, kind, label, site_id, audit_id, view_count, revoked_at, created_at
    FROM share_links WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `;
}
