import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSessionOrRedirect } from '@/lib/auth/session';
import { sql } from '@/lib/db';
import { ENGINE_LABELS, PLANS, formatLimit, type EngineId } from '@/lib/billing/plans';
import { getUsage } from '@/lib/billing/usage';
import { engineStatus } from '@/lib/citations';
import { Badge, Card, CardHeader, EmptyState, Notice, Stat, hostOf, scoreTone, timeAgo } from '@/components/ui';
import { ScoreRing } from '@/components/charts';
import { AddSiteForm } from '@/components/AddSiteForm';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

type SiteRow = {
  id: string;
  name: string;
  origin: string;
  brand_name: string;
  latest_score: number | null;
  latest_audit_at: string | null;
  prompt_count: number;
  competitor_count: number;
  visibility: string | null;
  checks: number;
  simulated: number;
};

export default async function DashboardPage() {
  const session = await requireSessionOrRedirect();
  const plan = PLANS[session.plan];

  const [sites, auditsUsed, engines] = await Promise.all([
    sql<SiteRow>`
      SELECT s.id, s.name, s.origin, s.brand_name,
        (SELECT overall_score FROM audits a
          WHERE a.site_id = s.id AND a.status = 'complete'
          ORDER BY a.completed_at DESC LIMIT 1) AS latest_score,
        (SELECT completed_at FROM audits a
          WHERE a.site_id = s.id AND a.status = 'complete'
          ORDER BY a.completed_at DESC LIMIT 1) AS latest_audit_at,
        (SELECT count(*)::int FROM tracked_prompts p WHERE p.site_id = s.id) AS prompt_count,
        (SELECT count(*)::int FROM competitors c WHERE c.site_id = s.id) AS competitor_count,
        v.visibility, coalesce(v.checks, 0) AS checks, coalesce(v.simulated, 0) AS simulated
      FROM sites s
      LEFT JOIN LATERAL (
        WITH latest AS (
          SELECT DISTINCT ON (prompt_id, engine) brand_cited, mode
          FROM citation_checks
          WHERE site_id = s.id AND error IS NULL
          ORDER BY prompt_id, engine, checked_at DESC
        )
        SELECT count(*)::int AS checks,
               count(*) FILTER (WHERE mode = 'simulated')::int AS simulated,
               round(avg(CASE WHEN brand_cited THEN 1.0 ELSE 0.0 END) * 100, 1) AS visibility
        FROM latest
      ) v ON true
      WHERE s.workspace_id = ${session.workspaceId}
      ORDER BY s.created_at ASC
    `,
    getUsage(session.workspaceId, 'audits'),
    Promise.resolve(engineStatus()),
  ]);

  const tracked = sites.reduce((n, s) => n + s.prompt_count, 0);
  const scored = sites.filter((s) => s.latest_score !== null);
  const avgScore = scored.length
    ? Math.round(scored.reduce((n, s) => n + (s.latest_score ?? 0), 0) / scored.length)
    : null;
  const withChecks = sites.filter((s) => s.checks > 0);
  const avgVisibility = withChecks.length
    ? Math.round(
        withChecks.reduce((n, s) => n + Number(s.visibility ?? 0), 0) / withChecks.length,
      )
    : null;

  const simulatedEngines = engines.filter((e) => !e.configured);
  const anySimulatedData = sites.some((s) => s.simulated > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Dashboard</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {session.workspaceName} · {plan.name} plan
          </p>
        </div>
        <p className="text-sm text-ink-500">
          {formatLimit(auditsUsed)} / {formatLimit(plan.auditsPerMonth)} audits this month
        </p>
      </div>

      {simulatedEngines.length === engines.length && anySimulatedData ? (
        <Notice tone="warn" title="Citation data is simulated on this deployment">
          No engine API keys are configured, so citation checks return deterministic sample
          data labelled <strong>Simulated</strong> everywhere, including exports. Audits and
          scores are always real — they need no API key. Add{' '}
          <code className="font-mono text-xs">OPENAI_API_KEY</code>,{' '}
          <code className="font-mono text-xs">PERPLEXITY_API_KEY</code> or the DataForSEO
          credentials to switch an engine to live.
        </Notice>
      ) : null}

      <Card>
        <div className="grid divide-y divide-ink-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          <Stat label="Sites" value={`${sites.length}`} note={`of ${formatLimit(plan.sites)} on your plan`} />
          <Stat
            label="Average AEO score"
            value={avgScore === null ? '—' : `${avgScore}`}
            note={scored.length ? `across ${scored.length} audited site${scored.length === 1 ? '' : 's'}` : 'run an audit to see this'}
            tone={avgScore === null ? undefined : scoreTone(avgScore)}
          />
          <Stat
            label="AI visibility"
            value={avgVisibility === null ? '—' : `${avgVisibility}%`}
            note={withChecks.length ? 'of tracked prompts cite you' : 'run a citation check to see this'}
            tone={avgVisibility === null ? undefined : scoreTone(avgVisibility)}
          />
          <Stat
            label="Tracked prompts"
            value={`${tracked}`}
            note={`of ${formatLimit(plan.prompts)} on your plan`}
          />
        </div>
      </Card>

      {sites.length === 0 ? (
        <Card>
          <CardHeader title="Add your first site" description="We will crawl it, score it and start tracking citations." />
          <div className="p-5">
            <AddSiteForm />
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader
                title="Your sites"
                description="Latest AEO score and current AI visibility."
                action={
                  <Link
                    href="/app/sites"
                    className="text-sm font-semibold text-brand-600 hover:text-brand-700"
                  >
                    Manage sites →
                  </Link>
                }
              />
              <ul className="divide-y divide-ink-100">
                {sites.map((site) => (
                  <li key={site.id}>
                    <Link
                      href={`/app/sites/${site.id}`}
                      className="flex items-center gap-4 px-5 py-4 transition hover:bg-ink-50"
                    >
                      {site.latest_score === null ? (
                        <div className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full border-2 border-dashed border-ink-200 text-[10px] text-ink-400">
                          no audit
                        </div>
                      ) : (
                        <ScoreRing score={site.latest_score} size={72} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-ink-900">{site.name}</p>
                        <p className="truncate text-xs text-ink-500">{hostOf(site.origin)}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone="neutral">{site.prompt_count} prompts</Badge>
                          <Badge tone="neutral">{site.competitor_count} competitors</Badge>
                          {site.checks > 0 ? (
                            <Badge tone={Number(site.visibility) >= 50 ? 'good' : 'medium'}>
                              {site.visibility}% visibility
                            </Badge>
                          ) : (
                            <Badge tone="low">no checks yet</Badge>
                          )}
                          {site.simulated > 0 ? <Badge tone="medium">simulated</Badge> : null}
                        </div>
                      </div>
                      <div className="hidden shrink-0 text-right text-xs text-ink-400 sm:block">
                        audited {timeAgo(site.latest_audit_at)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {sites.length < plan.sites ? (
                <div className="border-t border-ink-200 p-5">
                  <AddSiteForm compact />
                </div>
              ) : null}
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Engine status" description="Which engines run live on this deployment." />
              <ul className="divide-y divide-ink-100">
                {engines.map((e) => (
                  <li key={e.engine} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-800">
                        {ENGINE_LABELS[e.engine as EngineId]}
                      </p>
                      {!e.configured ? (
                        <p className="truncate text-[11px] text-ink-400">
                          set {e.requires.join(' + ')}
                        </p>
                      ) : null}
                    </div>
                    <Badge tone={e.configured ? 'good' : 'medium'}>
                      {e.configured ? 'Live' : 'Simulated'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Next steps" />
              <ul className="space-y-2.5 p-5 text-sm text-ink-600">
                {!scored.length ? (
                  <li>→ Run your first audit from a site page.</li>
                ) : null}
                {!tracked ? (
                  <li>→ Add the prompts your buyers actually ask.</li>
                ) : null}
                {!sites.some((s) => s.competitor_count > 0) ? (
                  <li>→ Add competitors to see share of voice.</li>
                ) : null}
                {!plan.weeklyAutoChecks ? (
                  <li>
                    →{' '}
                    <Link href="/app/billing" className="font-semibold text-brand-600">
                      Upgrade
                    </Link>{' '}
                    for weekly automatic checks.
                  </li>
                ) : null}
                {scored.length && tracked ? <li>→ Export a client report from Reports.</li> : null}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {sites.length === 0 ? (
        <EmptyState
          title="Nothing tracked yet"
          description="Add a site above. We will crawl it, score it against the six AEO pillars, and give you a prioritised fix list."
        />
      ) : null}
    </div>
  );
}
