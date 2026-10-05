import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql, sqlOne } from '@/lib/db';
import { ENGINE_LABELS, type EngineId } from '@/lib/billing/plans';
import { brandingFor, buildAuditReportData, buildCitationReportData, loadWorkspace } from '@/lib/reports';
import { BenchmarkBars, EngineBars, PillarBars, ScoreRing, VisibilityChart } from '@/components/charts';
import { Badge, Card, CardHeader, CodeBlock, Notice, hostOf } from '@/components/ui';
import { visibilityHistory } from '@/lib/citations/run';
import { EFFORT_LABELS, SEVERITY_LABELS } from '@/lib/aeo/issues';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI search report',
  // A client link is unlisted by design; it must not end up in a search index.
  robots: { index: false, follow: false, nocache: true },
};

type ShareRow = {
  id: string;
  workspace_id: string;
  site_id: string | null;
  audit_id: string | null;
  kind: 'audit' | 'citations' | 'combined';
  label: string | null;
  revoked_at: string | null;
  expires_at: string | null;
};

/**
 * Public, read-only client report. No session; authorisation is the token alone, which
 * is why the projection is built from scratch here rather than reusing an authed query.
 */
export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const link = await sqlOne<ShareRow>`
    SELECT id, workspace_id, site_id, audit_id, kind, label, revoked_at, expires_at
    FROM share_links WHERE token = ${token}
  `;
  if (!link) notFound();

  if (link.revoked_at || (link.expires_at && new Date(link.expires_at) < new Date())) {
    return (
      <Shell brandName="Report">
        <Card className="p-8 text-center">
          <h1 className="text-xl font-bold text-ink-900">This link is no longer active</h1>
          <p className="mt-2 text-sm text-ink-500">
            It was revoked or has expired. Ask whoever shared it for a new one.
          </p>
        </Card>
      </Shell>
    );
  }

  const workspace = await loadWorkspace(link.workspace_id);
  if (!workspace) notFound();
  const branding = brandingFor(workspace);

  // Fire-and-forget view count; a failure here must not break the page.
  await sql`UPDATE share_links SET view_count = view_count + 1 WHERE id = ${link.id}`.catch(() => []);

  const wantsAudit = link.kind === 'audit' || link.kind === 'combined';
  const wantsCitations = link.kind === 'citations' || link.kind === 'combined';

  const auditId =
    link.audit_id ??
    (wantsAudit && link.site_id
      ? (
          await sqlOne<{ id: string }>`
            SELECT id FROM audits
            WHERE site_id = ${link.site_id} AND status = 'complete'
            ORDER BY completed_at DESC LIMIT 1
          `
        )?.id ?? null
      : null);

  const [audit, citations, history] = await Promise.all([
    wantsAudit && auditId ? buildAuditReportData(auditId) : null,
    wantsCitations && link.site_id ? buildCitationReportData(link.site_id) : null,
    wantsCitations && link.site_id ? visibilityHistory(link.site_id, 90) : [],
  ]);

  if (!audit && !citations) {
    return (
      <Shell brandName={branding.productName} accent={branding.brandColour}>
        <Card className="p-8 text-center">
          <h1 className="text-xl font-bold text-ink-900">Nothing to show yet</h1>
          <p className="mt-2 text-sm text-ink-500">
            This report has no completed audit or citation data behind it.
          </p>
        </Card>
      </Shell>
    );
  }

  const siteName = audit?.site.name ?? citations?.site.name ?? 'Report';
  const siteOrigin = audit?.site.origin ?? citations?.site.origin ?? '';

  const byDay = new Map<string, { cited: number; checks: number }>();
  for (const row of history) {
    const e = byDay.get(row.day) ?? { cited: 0, checks: 0 };
    e.cited += row.cited;
    e.checks += row.checks;
    byDay.set(row.day, e);
  }
  const chartPoints = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      day,
      visibility: v.checks ? Math.round((v.cited / v.checks) * 1000) / 10 : 0,
    }));

  return (
    <Shell
      brandName={branding.productName}
      accent={branding.brandColour}
      logoUrl={workspace.brand_logo_url}
    >
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: branding.brandColour }}>
          AI search visibility report
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
          {siteName}
        </h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {siteOrigin ? hostOf(siteOrigin) : ''}
          {link.label ? ` · ${link.label}` : ''}
          {' · '}
          {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </header>

      {citations?.anySimulated ? (
        <div className="mb-6">
          <Notice tone="warn" title="Some figures in this report are simulated">
            Citation checks for one or more engines ran without live API access, so those numbers
            are illustrative rather than measured. Audit scores are measured directly from the site.
          </Notice>
        </div>
      ) : null}

      {audit ? (
        <>
          <Card>
            <div className="flex flex-col items-center gap-7 p-7 sm:flex-row sm:items-start">
              <ScoreRing score={audit.score.overall} grade={audit.score.grade} size={140} />
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h2 className="text-lg font-bold text-ink-900">Grade {audit.score.grade}</h2>
                  {audit.score.previous !== null ? (
                    <Badge tone={audit.score.overall >= audit.score.previous ? 'good' : 'critical'}>
                      {audit.score.overall >= audit.score.previous ? '+' : ''}
                      {audit.score.overall - audit.score.previous} since last review
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{audit.score.summary}</p>
                <p className="mt-2 text-xs text-ink-400">
                  {audit.pagesCrawled} page{audit.pagesCrawled === 1 ? '' : 's'} analysed
                </p>
              </div>
            </div>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Score breakdown" />
              <PillarBars pillars={audit.pillars} />
            </Card>
            <Card>
              <CardHeader title="AI crawler access" />
              <ul className="divide-y divide-ink-100">
                {audit.aiAccess.map((a) => (
                  <li key={a.label} className="flex items-center gap-3 px-5 py-2.5">
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.allowed ? 'bg-emerald-500' : 'bg-red-500'}`}
                    />
                    <span className="flex-1 truncate text-sm text-ink-800">{a.label}</span>
                    <span className="truncate text-xs text-ink-400">{a.vendor}</span>
                    <Badge tone={a.allowed ? 'good' : 'critical'}>
                      {a.allowed ? 'Allowed' : 'Blocked'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {audit.actionPlan.length ? (
            <Card className="mt-6">
              <CardHeader title="Recommended next steps" />
              <ol className="divide-y divide-ink-100">
                {audit.actionPlan.map((step, i) => (
                  <li key={step.title} className="flex gap-4 px-5 py-4">
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                      style={{ background: branding.brandColour }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <p className="font-semibold text-ink-900">{step.title}</p>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                          {step.timeframe}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink-600">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}

          <Card className="mt-6">
            <CardHeader
              title={`Prioritised fixes (${audit.issues.length})`}
              description="Ranked by impact on the score divided by the effort to fix."
            />
            {audit.issues.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm font-semibold text-emerald-700">
                Every check passed. Nothing outstanding.
              </p>
            ) : (
              <ol className="divide-y divide-ink-100">
                {audit.issues.map((issue, i) => (
                  <li key={`${issue.title}-${i}`} className="px-5 py-5">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                      <span className="text-sm font-bold text-ink-300">{i + 1}</span>
                      <h3 className="min-w-0 flex-1 text-sm font-semibold text-ink-900">
                        {issue.title}
                      </h3>
                      <div className="flex shrink-0 gap-1.5">
                        <Badge tone={issue.severity}>{SEVERITY_LABELS[issue.severity]}</Badge>
                        <Badge tone="neutral">{EFFORT_LABELS[issue.effort]}</Badge>
                      </div>
                    </div>
                    <div className="mt-2.5 space-y-2 pl-7 text-sm">
                      <p className="whitespace-pre-line text-ink-700">{issue.whatItMeans}</p>
                      <p className="text-ink-500">
                        <span className="font-medium text-ink-600">Why it matters:</span>{' '}
                        {issue.whyItMatters}
                      </p>
                      <p className="text-ink-700">
                        <span className="font-medium">How to fix:</span> {issue.howToFix}
                      </p>
                      {issue.codeSnippet ? <CodeBlock>{issue.codeSnippet}</CodeBlock> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      ) : null}

      {citations ? (
        <>
          <Card className="mt-6">
            <CardHeader
              title="AI citation tracking"
              description={`How often the assistants name ${citations.site.brandName}.`}
            />
            <div className="grid divide-y divide-ink-100 sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  Visibility
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">
                  {citations.visibility.visibility}%
                </p>
                <p className="text-xs text-ink-500">of tracked prompts cite you</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  Share of voice
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">
                  {citations.visibility.avgSov}%
                </p>
                <p className="text-xs text-ink-500">of all brand mentions</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  Cited
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">
                  {citations.visibility.cited}/{citations.visibility.checks}
                </p>
                <p className="text-xs text-ink-500">prompt and engine pairs</p>
              </div>
            </div>
            {chartPoints.length > 1 ? (
              <div className="border-t border-ink-200 p-4">
                <VisibilityChart points={chartPoints} showSov={false} />
              </div>
            ) : null}
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Visibility by engine" />
              <EngineBars
                rows={citations.byEngine.map((e) => ({
                  label: ENGINE_LABELS[e.engine as EngineId],
                  visibility: e.visibility,
                  checks: e.checks,
                  cited: e.cited,
                }))}
              />
            </Card>
            <Card>
              <CardHeader title="Share of voice against competitors" />
              <BenchmarkBars rows={citations.benchmark} />
            </Card>
          </div>

          {citations.prompts.length ? (
            <Card className="mt-6">
              <CardHeader title="Prompt-level results" description="Most recent check per engine." />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-ink-200 text-left text-[11px] uppercase tracking-wide text-ink-400">
                      <th className="px-5 py-2.5 font-semibold">Prompt</th>
                      <th className="px-3 py-2.5 font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {citations.prompts.map((p) => (
                      <tr key={p.prompt} className="align-top">
                        <td className="px-5 py-3 text-ink-800">{p.prompt}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {p.results.map((r) => (
                              <Badge key={r.engine} tone={r.cited ? 'good' : 'low'}>
                                {ENGINE_LABELS[r.engine as EngineId]}
                                {r.cited ? ` #${r.position ?? '?'}` : ' —'}
                              </Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      <footer className="mt-10 border-t border-ink-200 pt-5 text-xs text-ink-400">
        {branding.footer ? <p className="font-medium text-ink-600">{branding.footer}</p> : null}
        {branding.contact ? <p className="mt-0.5">{branding.contact}</p> : null}
        {!branding.whiteLabel ? (
          <p className="mt-2">
            Generated by Citation Radar —{' '}
            <Link href="/" className="underline">
              citationradar.app
            </Link>
          </p>
        ) : null}
      </footer>
    </Shell>
  );
}

function Shell({
  children,
  brandName,
  accent = '#4f46e5',
  logoUrl,
}: {
  children: React.ReactNode;
  brandName: string;
  accent?: string;
  logoUrl?: string | null;
}) {
  return (
    <div className="min-h-screen bg-ink-50">
      <div aria-hidden className="h-1.5 w-full" style={{ background: accent }} />
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          {logoUrl ? (
            // A client-supplied logo URL: rendered with a plain img so no image
            // optimiser needs to be allow-listed for arbitrary remote hosts.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={brandName} className="h-8 w-auto max-w-[160px] object-contain" />
          ) : (
            <span className="font-bold tracking-tight text-ink-900">{brandName}</span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
    </div>
  );
}
