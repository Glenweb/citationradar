import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAuditByPublicId, getAuditIssues, type StoredPillars } from '@/lib/aeo/run';
import { PILLARS } from '@/lib/aeo/score';
import { ScoreRing, PillarBars } from '@/components/charts';
import { Badge, Card, CardHeader, CodeBlock, Notice, hostOf } from '@/components/ui';
import { FreeAuditForm } from '@/components/FreeAuditForm';
import { EFFORT_LABELS, SEVERITY_LABELS } from '@/lib/aeo/issues';

/** How many fixes an anonymous visitor sees before the signup wall. */
const FREE_FIXES_SHOWN = 3;

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const audit = await getAuditByPublicId(publicId).catch(() => null);
  if (!audit) return { title: 'Audit not found' };
  return {
    title: `${hostOf(audit.origin)} scores ${audit.overall_score ?? '—'}/100 for AI search`,
    description: audit.summary ?? 'AI search visibility audit by Citation Radar.',
    robots: { index: false, follow: false },
  };
}

type AiAccessEntry = { label: string; vendor: string; purpose: string; allowed: boolean };

export default async function FreeAuditResultPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  const audit = await getAuditByPublicId(publicId);
  if (!audit) notFound();

  if (audit.status === 'failed') {
    return (
      <Shell>
        <Card className="p-8">
          <h1 className="text-xl font-bold text-ink-900">That audit could not complete</h1>
          <p className="mt-2 text-sm text-ink-600">{audit.error ?? 'The page could not be fetched.'}</p>
          <p className="mt-4 text-sm text-ink-500">
            This usually means the URL is wrong, the site is behind bot protection, or it was too
            slow to respond. Worth knowing either way: if our crawler cannot reach it, neither can
            the AI crawlers.
          </p>
          <div className="mt-6 max-w-md">
            <FreeAuditForm size="sm" />
          </div>
        </Card>
      </Shell>
    );
  }

  if (audit.status !== 'complete') {
    return (
      <Shell>
        <Card className="p-8 text-center">
          <h1 className="text-xl font-bold text-ink-900">Audit in progress…</h1>
          <p className="mt-2 text-sm text-ink-600">Refresh in a few seconds.</p>
        </Card>
      </Shell>
    );
  }

  const stored = (audit.pillar_scores ?? {}) as StoredPillars & {
    ceiling?: { cap: number; reason: string } | null;
    rawOverall?: number;
  };
  const robots = (audit.robots ?? {}) as { aiAccess?: AiAccessEntry[] };
  const surface = (audit.answer_surface ?? {}) as {
    llmsTxt?: { present: boolean; wellFormed: boolean };
    llmsFullTxt?: { present: boolean };
    sitemap?: { present: boolean; urlCount: number };
  };
  const issues = await getAuditIssues(audit.id);

  const shown = issues.slice(0, FREE_FIXES_SHOWN);
  const hidden = issues.length - shown.length;
  const blocked = (robots.aiAccess ?? []).filter((a) => !a.allowed);

  const pillars = (stored.pillars ?? []).map((p) => ({
    id: p.id,
    label: p.label,
    score: p.score,
    weight: p.weight,
    blurb: PILLARS.find((x) => x.id === p.id)?.blurb,
  }));

  return (
    <Shell>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
          Free AI search audit
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
          {hostOf(audit.origin)}
        </h1>
        <p className="mt-1 break-all text-sm text-ink-500">{audit.target_url}</p>
      </div>

      {/* Headline */}
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center gap-7 p-7 sm:flex-row sm:items-start">
          <ScoreRing score={audit.overall_score ?? 0} grade={audit.grade ?? undefined} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h2 className="text-lg font-bold text-ink-900">Grade {audit.grade}</h2>
              {blocked.length ? (
                <Badge tone="critical">{blocked.length} AI crawler{blocked.length === 1 ? '' : 's'} blocked</Badge>
              ) : (
                <Badge tone="good">All AI crawlers allowed</Badge>
              )}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">{audit.summary}</p>

            {stored.ceiling ? (
              <div className="mt-4">
                <Notice tone="danger" title={`Score capped at ${stored.ceiling.cap}/100`}>
                  {stored.ceiling.reason}
                  {typeof stored.rawOverall === 'number' ? (
                    <> Everything else scored {stored.rawOverall}/100.</>
                  ) : null}
                </Notice>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Crawler access — the headline finding for most sites */}
      <Card className="mt-6">
        <CardHeader
          title="Can the AI crawlers reach you?"
          description="Read from your robots.txt. A blocked crawler means that engine has no copy of your content."
        />
        <ul className="divide-y divide-ink-100">
          {(robots.aiAccess ?? []).map((agent) => (
            <li key={agent.label} className="flex items-center gap-3 px-5 py-3">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${agent.allowed ? 'bg-emerald-500' : 'bg-red-500'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{agent.label}</p>
                <p className="truncate text-xs text-ink-500">
                  {agent.vendor} · {agent.purpose}
                </p>
              </div>
              <Badge tone={agent.allowed ? 'good' : 'critical'}>
                {agent.allowed ? 'Allowed' : 'Blocked'}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Score breakdown" description="Weighted by how much each actually affects citations." />
          <PillarBars pillars={pillars} />
        </Card>

        <Card>
          <CardHeader title="Answer surface" description="The files that brief an AI assistant about your site." />
          <ul className="divide-y divide-ink-100">
            {[
              {
                label: '/llms.txt',
                ok: !!surface.llmsTxt?.present,
                note: surface.llmsTxt?.present
                  ? surface.llmsTxt.wellFormed
                    ? 'Present and well-formed'
                    : 'Present but not in the expected format'
                  : 'Not published',
              },
              {
                label: '/llms-full.txt',
                ok: !!surface.llmsFullTxt?.present,
                note: surface.llmsFullTxt?.present ? 'Present' : 'Not published (optional)',
              },
              {
                label: 'Sitemap',
                ok: !!surface.sitemap?.present,
                note: surface.sitemap?.present
                  ? `${surface.sitemap.urlCount} URLs`
                  : 'No reachable sitemap',
              },
            ].map((row) => (
              <li key={row.label} className="flex items-center gap-3 px-5 py-3.5">
                <span aria-hidden className={`text-sm ${row.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                  {row.ok ? '✓' : '✗'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm text-ink-900">{row.label}</p>
                  <p className="text-xs text-ink-500">{row.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Fix list, partly gated */}
      <Card className="mt-6">
        <CardHeader
          title={`${issues.length} fix${issues.length === 1 ? '' : 'es'} found`}
          description="Ranked by score impact divided by how much work it is."
        />

        {issues.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-semibold text-emerald-700">Nothing to fix on this page.</p>
            <p className="mt-1 text-sm text-ink-500">
              Every check passed. Add the site to a workspace to track citations over time.
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-ink-100">
            {shown.map((issue, i) => (
              <li key={issue.id} className="px-5 py-5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <span className="text-sm font-bold text-ink-300">{i + 1}</span>
                  <h3 className="min-w-0 flex-1 text-base font-semibold text-ink-900">
                    {issue.title}
                  </h3>
                  <div className="flex shrink-0 gap-1.5">
                    <Badge tone={issue.severity}>{SEVERITY_LABELS[issue.severity]}</Badge>
                    <Badge tone="neutral">{EFFORT_LABELS[issue.effort]}</Badge>
                    <Badge tone="info">+{Number(issue.impact_points).toFixed(1)} pts</Badge>
                  </div>
                </div>
                <div className="mt-3 space-y-2.5 pl-7 text-sm">
                  <p className="text-ink-700">{issue.what_it_means}</p>
                  <p className="text-ink-500">
                    <span className="font-medium text-ink-600">Why it matters:</span>{' '}
                    {issue.why_it_matters}
                  </p>
                  <p className="text-ink-700">
                    <span className="font-medium">How to fix:</span> {issue.how_to_fix}
                  </p>
                  {issue.code_snippet ? <CodeBlock>{issue.code_snippet}</CodeBlock> : null}
                </div>
              </li>
            ))}
          </ol>
        )}

        {hidden > 0 ? (
          <div className="border-t border-ink-200 bg-ink-50 px-5 py-7 text-center">
            <p className="text-base font-semibold text-ink-900">
              {hidden} more fix{hidden === 1 ? '' : 'es'} in the full report
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">
              A free account unlocks the rest, audits every page rather than one, and tracks whether
              the assistants start citing you once you have fixed them.
            </p>
            <Link
              href="/signup"
              className="mt-4 inline-flex rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Create a free account
            </Link>
          </div>
        ) : null}
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="text-sm font-semibold text-ink-900">Audit another URL</h2>
        <div className="mt-3 max-w-lg">
          <FreeAuditForm size="sm" />
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-ink-900">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-sm text-white">
              ◎
            </span>
            Citation Radar
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/login" className="rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-50">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-ink-900 px-4 py-2 font-semibold text-white hover:bg-ink-800"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
    </div>
  );
}
