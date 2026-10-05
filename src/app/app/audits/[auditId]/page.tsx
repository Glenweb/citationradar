import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { sqlOne } from '@/lib/db';
import { getAuditIssues, getAuditPages, type AuditRecord, type StoredPillars } from '@/lib/aeo/run';
import { PILLARS } from '@/lib/aeo/score';
import { PLANS } from '@/lib/billing/plans';
import { PillarBars, ScoreRing } from '@/components/charts';
import { IssueList, type IssueItem } from '@/components/IssueList';
import { Badge, Card, CardHeader, Notice, Stat, hostOf } from '@/components/ui';
import { RunAuditButton } from '@/components/RunAuditButton';

export const metadata: Metadata = { title: 'Audit report' };
export const dynamic = 'force-dynamic';

type AiAccessEntry = { label: string; vendor: string; purpose: string; allowed: boolean };

export default async function AuditReportPage({
  params,
}: {
  params: Promise<{ auditId: string }>;
}) {
  const session = await requireSession();
  const { auditId } = await params;
  const plan = PLANS[session.plan];

  const audit = await sqlOne<AuditRecord & { site_name: string | null; site_id: string | null }>`
    SELECT a.*, s.name AS site_name FROM audits a
    LEFT JOIN sites s ON s.id = a.site_id
    WHERE a.id = ${auditId} AND a.workspace_id = ${session.workspaceId}
  `;
  if (!audit) notFound();

  if (audit.status === 'failed') {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold text-ink-900">Audit failed</h1>
        <Notice tone="danger" title="The crawl could not complete">
          {audit.error ?? 'Unknown error.'}
        </Notice>
        <p className="text-sm text-ink-500">
          If our crawler cannot fetch the site, the AI crawlers cannot either — so this is worth
          investigating. Common causes are bot protection, an invalid TLS certificate, or a very
          slow response.
        </p>
        {audit.site_id ? (
          <RunAuditButton siteId={audit.site_id} pageCap={plan.pagesPerAudit} variant="secondary" />
        ) : null}
      </div>
    );
  }

  if (audit.status !== 'complete') {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl font-bold text-ink-900">Audit running…</h1>
        <p className="mt-2 text-sm text-ink-500">Refresh this page in a moment.</p>
      </Card>
    );
  }

  const [issues, pages] = await Promise.all([getAuditIssues(auditId), getAuditPages(auditId)]);
  const stored = (audit.pillar_scores ?? {}) as StoredPillars & {
    ceiling?: { cap: number; reason: string } | null;
    rawOverall?: number;
    actionPlan?: { title: string; detail: string; timeframe: string }[];
  };
  const robots = (audit.robots ?? {}) as { aiAccess?: AiAccessEntry[]; sitemaps?: string[] };
  const surface = (audit.answer_surface ?? {}) as {
    llmsTxt?: { present: boolean; wellFormed: boolean };
    llmsFullTxt?: { present: boolean };
    sitemap?: { present: boolean; urlCount: number };
  };

  const delta = audit.previous_score === null ? null : (audit.overall_score ?? 0) - audit.previous_score;
  const blocked = (robots.aiAccess ?? []).filter((a) => !a.allowed);
  const jsPages = pages.filter((p) => p.js_dependent);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav className="text-sm text-ink-500">
            <Link href="/app/sites" className="hover:text-ink-800">Sites</Link>
            {audit.site_id ? (
              <>
                {' / '}
                <Link href={`/app/sites/${audit.site_id}`} className="hover:text-ink-800">
                  {audit.site_name ?? hostOf(audit.origin)}
                </Link>
              </>
            ) : null}
            {' / '}
            <span className="text-ink-700">Audit</span>
          </nav>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">
            {audit.site_name ?? hostOf(audit.origin)}
          </h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {audit.pages_crawled} page{audit.pages_crawled === 1 ? '' : 's'} crawled
            {audit.pages_capped ? ` (capped at your plan limit of ${plan.pagesPerAudit})` : ''}
            {audit.duration_ms ? ` in ${(audit.duration_ms / 1000).toFixed(1)}s` : ''}
            {audit.completed_at ? ` · ${new Date(audit.completed_at).toLocaleString('en-GB')}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {plan.pdfExport ? (
            <a
              href={`/api/reports/audit/${audit.id}`}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-800 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
            >
              Download PDF
            </a>
          ) : (
            <Link
              href="/app/billing"
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-500 ring-1 ring-inset ring-ink-200 transition hover:bg-ink-50"
            >
              PDF export — upgrade
            </Link>
          )}
          {audit.site_id ? (
            <RunAuditButton siteId={audit.site_id} pageCap={plan.pagesPerAudit} />
          ) : null}
        </div>
      </div>

      {/* Headline */}
      <Card>
        <div className="flex flex-col items-center gap-7 p-7 sm:flex-row sm:items-start">
          <ScoreRing score={audit.overall_score ?? 0} grade={audit.grade ?? undefined} size={148} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h2 className="text-lg font-bold text-ink-900">Grade {audit.grade}</h2>
              {delta !== null ? (
                <Badge tone={delta > 0 ? 'good' : delta < 0 ? 'critical' : 'neutral'}>
                  {delta > 0 ? '+' : ''}
                  {delta} vs last audit
                </Badge>
              ) : null}
              {blocked.length ? (
                <Badge tone="critical">
                  {blocked.length} crawler{blocked.length === 1 ? '' : 's'} blocked
                </Badge>
              ) : (
                <Badge tone="good">All crawlers allowed</Badge>
              )}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">{audit.summary}</p>

            {stored.ceiling ? (
              <div className="mt-4">
                <Notice tone="danger" title={`Score capped at ${stored.ceiling.cap}/100`}>
                  {stored.ceiling.reason}
                  {typeof stored.rawOverall === 'number' ? (
                    <> Everything else on the site scored {stored.rawOverall}/100, so the ceiling
                    is the only thing between you and that number.</>
                  ) : null}
                </Notice>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid divide-y divide-ink-100 border-t border-ink-200 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          <Stat label="Open fixes" value={issues.filter((i) => i.status === 'open').length} />
          <Stat
            label="Critical"
            value={issues.filter((i) => i.severity === 'critical' && i.status === 'open').length}
            tone={issues.some((i) => i.severity === 'critical' && i.status === 'open') ? 'bad' : 'good'}
          />
          <Stat
            label="JS-only pages"
            value={`${jsPages.length}/${pages.length}`}
            tone={jsPages.length ? 'bad' : 'good'}
            note="invisible to AI crawlers"
          />
          <Stat
            label="Recoverable points"
            value={`+${issues
              .filter((i) => i.status === 'open')
              .reduce((n, i) => n + Number(i.impact_points), 0)
              .toFixed(1)}`}
            note="if every open fix is done"
          />
        </div>
      </Card>

      {/* Action plan */}
      {stored.actionPlan?.length ? (
        <Card>
          <CardHeader
            title="What to do, in order"
            description="Sequenced so blockers come before refinements."
          />
          <ol className="divide-y divide-ink-100">
            {stored.actionPlan.map((step, i) => (
              <li key={step.title} className="flex gap-4 px-5 py-4">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="font-semibold text-ink-900">{step.title}</p>
                    <Badge tone="info">{step.timeframe}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-600">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title={`Prioritised fixes (${issues.length})`}
              description="Ranked by score impact divided by effort. Critical blockers always lead."
            />
            <IssueList auditId={audit.id} issues={issues as unknown as IssueItem[]} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Score breakdown" />
            <PillarBars
              pillars={(stored.pillars ?? []).map((p) => ({
                id: p.id,
                label: p.label,
                score: p.score,
                weight: p.weight,
                blurb: PILLARS.find((x) => x.id === p.id)?.blurb,
              }))}
            />
          </Card>

          <Card>
            <CardHeader title="AI crawler access" description="From robots.txt." />
            <ul className="divide-y divide-ink-100">
              {(robots.aiAccess ?? []).map((a) => (
                <li key={a.label} className="flex items-center gap-3 px-5 py-2.5">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.allowed ? 'bg-emerald-500' : 'bg-red-500'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink-800">{a.label}</p>
                    <p className="truncate text-[11px] text-ink-400">{a.vendor}</p>
                  </div>
                  <Badge tone={a.allowed ? 'good' : 'critical'}>
                    {a.allowed ? 'Allowed' : 'Blocked'}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Answer surface" />
            <ul className="divide-y divide-ink-100 text-sm">
              {[
                { label: '/llms.txt', ok: !!surface.llmsTxt?.present, note: surface.llmsTxt?.present ? (surface.llmsTxt.wellFormed ? 'well-formed' : 'wrong format') : 'missing' },
                { label: '/llms-full.txt', ok: !!surface.llmsFullTxt?.present, note: surface.llmsFullTxt?.present ? 'present' : 'missing' },
                { label: 'Sitemap', ok: !!surface.sitemap?.present, note: surface.sitemap?.present ? `${surface.sitemap.urlCount} URLs` : 'missing' },
              ].map((r) => (
                <li key={r.label} className="flex items-center gap-3 px-5 py-2.5">
                  <span aria-hidden className={r.ok ? 'text-emerald-600' : 'text-red-500'}>
                    {r.ok ? '✓' : '✗'}
                  </span>
                  <span className="flex-1 font-mono text-xs text-ink-800">{r.label}</span>
                  <span className="text-xs text-ink-500">{r.note}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {/* Crawled pages */}
      <Card>
        <CardHeader
          title={`Pages crawled (${pages.length})`}
          description="What our crawler received, with no JavaScript executed."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-[11px] uppercase tracking-wide text-ink-400">
                <th className="px-5 py-2.5 font-semibold">URL</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Words</th>
                <th className="px-3 py-2.5 font-semibold">H1s</th>
                <th className="px-3 py-2.5 font-semibold">JSON-LD</th>
                <th className="px-3 py-2.5 font-semibold">FAQ</th>
                <th className="px-5 py-2.5 font-semibold">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {pages.map((p) => (
                <tr key={p.url} className="align-top">
                  <td className="max-w-xs truncate px-5 py-2.5 font-mono text-xs text-ink-700" title={p.url}>
                    {p.url}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <span className={(p.status_code ?? 0) >= 400 || p.status_code === null ? 'font-semibold text-red-600' : 'text-ink-600'}>
                      {p.status_code ?? 'err'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-ink-600">{p.word_count}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <span className={p.h1_count === 1 ? 'text-ink-600' : 'font-semibold text-amber-600'}>
                      {p.h1_count}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {p.jsonld_blocks === 0 ? (
                      <span className="text-red-600">none</span>
                    ) : p.jsonld_invalid > 0 ? (
                      <span className="font-semibold text-amber-600">{p.jsonld_invalid} invalid</span>
                    ) : (
                      <span className="text-emerald-600">{p.jsonld_blocks} ok</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {p.has_faq ? <span className="text-emerald-600">yes</span> : <span className="text-ink-400">no</span>}
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {p.js_dependent ? <Badge tone="critical">JS-only</Badge> : null}
                      {p.heading_skips > 0 ? <Badge tone="medium">{p.heading_skips} heading skips</Badge> : null}
                      {p.issues?.length ? <Badge tone="low">{p.issues[0]}</Badge> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
