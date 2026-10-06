import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSessionOrRedirect } from '@/lib/auth/session';
import { sql } from '@/lib/db';
import { PLANS, formatLimit } from '@/lib/billing/plans';
import { AddSiteForm } from '@/components/AddSiteForm';
import { Badge, Card, CardHeader, Notice, hostOf, timeAgo } from '@/components/ui';

export const metadata: Metadata = { title: 'Sites' };
export const dynamic = 'force-dynamic';

export default async function SitesPage() {
  const session = await requireSessionOrRedirect();
  const plan = PLANS[session.plan];

  const sites = await sql<{
    id: string;
    name: string;
    origin: string;
    brand_name: string;
    created_at: string;
    latest_score: number | null;
    latest_audit_at: string | null;
    prompt_count: number;
    competitor_count: number;
  }>`
    SELECT s.id, s.name, s.origin, s.brand_name, s.created_at,
      (SELECT overall_score FROM audits a
        WHERE a.site_id = s.id AND a.status = 'complete'
        ORDER BY a.completed_at DESC LIMIT 1) AS latest_score,
      (SELECT completed_at FROM audits a
        WHERE a.site_id = s.id AND a.status = 'complete'
        ORDER BY a.completed_at DESC LIMIT 1) AS latest_audit_at,
      (SELECT count(*)::int FROM tracked_prompts p WHERE p.site_id = s.id) AS prompt_count,
      (SELECT count(*)::int FROM competitors c WHERE c.site_id = s.id) AS competitor_count
    FROM sites s
    WHERE s.workspace_id = ${session.workspaceId}
    ORDER BY s.created_at ASC
  `;

  const atLimit = sites.length >= plan.sites;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Sites</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {sites.length} of {formatLimit(plan.sites)} on the {plan.name} plan
        </p>
      </div>

      {atLimit ? (
        <Notice tone="warn" title={`You have used all ${plan.sites} site${plan.sites === 1 ? '' : 's'} on your plan`}>
          <Link href="/app/billing" className="font-semibold underline">
            Upgrade
          </Link>{' '}
          to add more.
        </Notice>
      ) : (
        <Card>
          <CardHeader title="Add a site" />
          <div className="p-5">
            <AddSiteForm />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Tracked sites" />
        {sites.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-500">No sites yet.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {sites.map((site) => (
              <li key={site.id}>
                <Link
                  href={`/app/sites/${site.id}`}
                  className="flex flex-wrap items-center gap-4 px-5 py-4 transition hover:bg-ink-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink-900">{site.name}</p>
                    <p className="truncate text-xs text-ink-500">
                      {hostOf(site.origin)} · tracking &ldquo;{site.brand_name}&rdquo;
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{site.prompt_count} prompts</Badge>
                    <Badge tone="neutral">{site.competitor_count} competitors</Badge>
                    {site.latest_score === null ? (
                      <Badge tone="low">never audited</Badge>
                    ) : (
                      <Badge tone={site.latest_score >= 70 ? 'good' : site.latest_score >= 45 ? 'medium' : 'critical'}>
                        {site.latest_score}/100
                      </Badge>
                    )}
                  </div>
                  <span className="hidden w-28 shrink-0 text-right text-xs text-ink-400 sm:block">
                    {timeAgo(site.latest_audit_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
