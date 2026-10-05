import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { sql, sqlOne } from '@/lib/db';
import { ENGINE_LABELS, PLANS, enginesForPlan, type EngineId } from '@/lib/billing/plans';
import {
  competitorBenchmark,
  currentVisibility,
  latestChecks,
  visibilityHistory,
} from '@/lib/citations/run';
import { BenchmarkBars, EngineBars, ScoreRing, VisibilityChart } from '@/components/charts';
import { PromptManager, type LatestResult, type PromptItem } from '@/components/PromptManager';
import { CompetitorManager, type CompetitorItem } from '@/components/CompetitorManager';
import { RunAuditButton } from '@/components/RunAuditButton';
import { Badge, Card, CardHeader, Notice, Stat, hostOf, scoreTone, timeAgo } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ siteId: string }>;
}): Promise<Metadata> {
  const { siteId } = await params;
  const session = await requireSession().catch(() => null);
  if (!session) return { title: 'Site' };
  const site = await sqlOne<{ name: string }>`
    SELECT name FROM sites WHERE id = ${siteId} AND workspace_id = ${session.workspaceId}
  `;
  return { title: site?.name ?? 'Site' };
}

export default async function SitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await requireSession();
  const { siteId } = await params;
  const plan = PLANS[session.plan];

  const site = await sqlOne<{
    id: string;
    name: string;
    origin: string;
    domain: string;
    brand_name: string;
    created_at: string;
  }>`
    SELECT id, name, origin, domain, brand_name, created_at
    FROM sites WHERE id = ${siteId} AND workspace_id = ${session.workspaceId}
  `;
  if (!site) notFound();

  const [audits, prompts, competitors, visibility, latest, history, benchmark, promptTotal] =
    await Promise.all([
      sql<{
        id: string;
        status: string;
        overall_score: number | null;
        previous_score: number | null;
        grade: string | null;
        pages_crawled: number;
        started_at: string;
        completed_at: string | null;
        error: string | null;
      }>`
        SELECT id, status, overall_score, previous_score, grade, pages_crawled,
               started_at, completed_at, error
        FROM audits WHERE site_id = ${siteId}
        ORDER BY started_at DESC LIMIT 12
      `,
      sql<PromptItem>`
        SELECT id, prompt, intent, engines, is_active, last_checked_at
        FROM tracked_prompts WHERE site_id = ${siteId} ORDER BY created_at ASC
      `,
      sql<CompetitorItem>`
        SELECT id, name, domain FROM competitors WHERE site_id = ${siteId} ORDER BY name ASC
      `,
      currentVisibility(siteId),
      latestChecks(siteId),
      visibilityHistory(siteId, 90),
      competitorBenchmark(siteId),
      sqlOne<{ n: number }>`
        SELECT count(*)::int AS n FROM tracked_prompts WHERE workspace_id = ${session.workspaceId}
      `,
    ]);

  const latestComplete = audits.find((a) => a.status === 'complete');

  // Collapse the per-engine daily rows into one point per day for the chart.
  const byDay = new Map<string, { cited: number; checks: number; sov: number }>();
  for (const row of history) {
    const entry = byDay.get(row.day) ?? { cited: 0, checks: 0, sov: 0 };
    entry.cited += row.cited;
    entry.checks += row.checks;
    entry.sov += Number(row.avg_sov) * row.checks;
    byDay.set(row.day, entry);
  }
  const chartPoints = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      day,
      visibility: v.checks ? Math.round((v.cited / v.checks) * 1000) / 10 : 0,
      sov: v.checks ? Math.round((v.sov / v.checks) * 10) / 10 : 0,
    }));

  const engineTotals = new Map<EngineId, { checks: number; cited: number; simulated: number }>();
  for (const row of latest) {
    const e = engineTotals.get(row.engine) ?? { checks: 0, cited: 0, simulated: 0 };
    e.checks += 1;
    if (row.brand_cited) e.cited += 1;
    if (row.mode === 'simulated') e.simulated += 1;
    engineTotals.set(row.engine, e);
  }

  const vis = Number(visibility?.visibility ?? 0);
  const checks = Number(visibility?.checks ?? 0);
  const anySimulated = latest.some((r) => r.mode === 'simulated');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav className="text-sm text-ink-500">
            <Link href="/app/sites" className="hover:text-ink-800">Sites</Link>
            {' / '}
            <span className="text-ink-700">{site.name}</span>
          </nav>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">{site.name}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            <a
              href={site.origin}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink-800 hover:underline"
            >
              {hostOf(site.origin)}
            </a>
            {' · tracking '}
            <span className="font-medium text-ink-700">&ldquo;{site.brand_name}&rdquo;</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {plan.pdfExport && checks > 0 ? (
            <a
              href={`/api/reports/citations/${site.id}`}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-800 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
            >
              Citation PDF
            </a>
          ) : null}
          <RunAuditButton siteId={site.id} pageCap={plan.pagesPerAudit} />
        </div>
      </div>

      {anySimulated ? (
        <Notice tone="warn" title="Some citation data on this page is simulated">
          Engines without an API key return deterministic sample data so the product is usable
          end to end. Every simulated figure is marked <strong>sim</strong>, and exports carry the
          same label. Audit scores are always real.
        </Notice>
      ) : null}

      {/* Summary */}
      <Card>
        <div className="grid divide-y divide-ink-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          <Stat
            label="AEO score"
            value={latestComplete?.overall_score ?? '—'}
            note={latestComplete ? `grade ${latestComplete.grade} · ${timeAgo(latestComplete.completed_at)}` : 'not audited yet'}
            tone={latestComplete?.overall_score ? scoreTone(latestComplete.overall_score) : undefined}
          />
          <Stat
            label="AI visibility"
            value={checks ? `${vis}%` : '—'}
            note={checks ? `${visibility?.cited} of ${checks} checks cite you` : 'no checks yet'}
            tone={checks ? scoreTone(vis) : undefined}
          />
          <Stat
            label="Share of voice"
            value={checks ? `${visibility?.avg_sov}%` : '—'}
            note="of all brand mentions"
          />
          <Stat
            label="Tracked"
            value={`${prompts.length}`}
            note={`prompts · ${competitors.length} competitors`}
          />
        </div>
      </Card>

      {/* Visibility history */}
      <Card>
        <CardHeader
          title="Citation history"
          description="How often the AI engines name you, over the last 90 days."
        />
        <div className="p-4">
          <VisibilityChart points={chartPoints} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Prompt tracker */}
          <Card>
            <CardHeader
              title="Prompt tracker"
              description="The questions you want to be the answer to."
            />
            <PromptManager
              siteId={site.id}
              prompts={prompts}
              results={latest as unknown as LatestResult[]}
              allowedEngines={enginesForPlan(session.plan)}
              promptLimit={plan.prompts}
              promptCount={Number(promptTotal?.n ?? 0)}
            />
          </Card>

          {/* Competitor benchmark */}
          <Card>
            <CardHeader
              title="Share of voice"
              description="Your mentions against each competitor's, across the latest check of every prompt."
            />
            <BenchmarkBars
              rows={benchmark.map((b) => ({
                name: b.name,
                isBrand: b.is_brand,
                mentions: b.mentions,
                presence: Number(b.presence),
              }))}
            />
          </Card>

          {/* Audit history */}
          <Card>
            <CardHeader title="Audit history" />
            {audits.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-500">
                No audits yet. Run one to get your score and fix list.
              </p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {audits.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/app/audits/${a.id}`}
                      className="flex items-center gap-4 px-5 py-3 transition hover:bg-ink-50"
                    >
                      <div className="w-12 shrink-0 text-center">
                        {a.overall_score === null ? (
                          <span className="text-xs text-ink-400">—</span>
                        ) : (
                          <span className="text-lg font-bold tabular-nums text-ink-900">
                            {a.overall_score}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink-800">
                          {a.status === 'complete'
                            ? `Grade ${a.grade} · ${a.pages_crawled} page${a.pages_crawled === 1 ? '' : 's'}`
                            : a.status === 'failed'
                              ? 'Failed'
                              : 'Running'}
                        </p>
                        <p className="text-xs text-ink-500">
                          {new Date(a.started_at).toLocaleString('en-GB')}
                          {a.error ? ` · ${a.error.slice(0, 80)}` : ''}
                        </p>
                      </div>
                      {a.previous_score !== null && a.overall_score !== null ? (
                        <Badge tone={a.overall_score >= a.previous_score ? 'good' : 'critical'}>
                          {a.overall_score >= a.previous_score ? '+' : ''}
                          {a.overall_score - a.previous_score}
                        </Badge>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {latestComplete?.overall_score != null ? (
            <Card>
              <CardHeader title="Latest score" />
              <div className="flex flex-col items-center gap-3 p-6">
                <ScoreRing
                  score={latestComplete.overall_score}
                  grade={latestComplete.grade ?? undefined}
                />
                <Link
                  href={`/app/audits/${latestComplete.id}`}
                  className="text-sm font-semibold text-brand-600 hover:text-brand-700"
                >
                  Open the full report →
                </Link>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Visibility by engine" />
            <EngineBars
              rows={[...engineTotals.entries()].map(([engine, v]) => ({
                label: ENGINE_LABELS[engine],
                visibility: v.checks ? Math.round((v.cited / v.checks) * 1000) / 10 : 0,
                checks: v.checks,
                cited: v.cited,
                simulated: v.simulated > 0,
              }))}
            />
          </Card>

          <Card>
            <CardHeader
              title="Competitors"
              description="Brands we look for alongside yours."
            />
            <CompetitorManager
              siteId={site.id}
              competitors={competitors}
              limit={plan.competitorsPerSite}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
