import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { sql } from '@/lib/db';
import { env } from '@/lib/env';
import { PLANS } from '@/lib/billing/plans';
import { listShareLinks } from '@/lib/reports';
import { ShareLinkManager, type ShareLinkItem } from '@/components/ShareLinkManager';
import { Badge, Card, CardHeader, Notice, hostOf } from '@/components/ui';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const session = await requireSession();
  const plan = PLANS[session.plan];

  const [sites, links] = await Promise.all([
    sql<{
      id: string;
      name: string;
      origin: string;
      latest_audit_id: string | null;
      latest_score: number | null;
      checks: number;
    }>`
      SELECT s.id, s.name, s.origin,
        (SELECT id FROM audits a WHERE a.site_id = s.id AND a.status = 'complete'
          ORDER BY a.completed_at DESC LIMIT 1) AS latest_audit_id,
        (SELECT overall_score FROM audits a WHERE a.site_id = s.id AND a.status = 'complete'
          ORDER BY a.completed_at DESC LIMIT 1) AS latest_score,
        (SELECT count(*)::int FROM citation_checks c WHERE c.site_id = s.id) AS checks
      FROM sites s
      WHERE s.workspace_id = ${session.workspaceId}
      ORDER BY s.created_at ASC
    `,
    listShareLinks(session.workspaceId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Reports</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Export a PDF or send a client a read-only link.
        </p>
      </div>

      {!plan.pdfExport ? (
        <Notice tone="warn" title="PDF export is a paid feature">
          The {plan.name} plan does not include exports.{' '}
          <Link href="/app/billing" className="font-semibold underline">
            Upgrade to Starter
          </Link>{' '}
          for PDFs, or Growth for white-label and client links.
        </Notice>
      ) : !plan.whiteLabel ? (
        <Notice tone="info" title="Reports carry the Citation Radar mark on your plan">
          <Link href="/app/billing" className="font-semibold underline">
            Upgrade to Growth
          </Link>{' '}
          to put your own brand, colour and footer on exports, and to send revocable client links.
        </Notice>
      ) : null}

      <Card>
        <CardHeader
          title="Download a report"
          description="Branded with your workspace settings."
        />
        {sites.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            Add a site first.{' '}
            <Link href="/app/sites" className="font-semibold text-brand-600">
              Go to Sites →
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {sites.map((site) => (
              <li key={site.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink-900">{site.name}</p>
                  <p className="truncate text-xs text-ink-500">{hostOf(site.origin)}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {site.latest_score !== null ? (
                      <Badge tone="info">AEO {site.latest_score}/100</Badge>
                    ) : (
                      <Badge tone="low">no audit yet</Badge>
                    )}
                    {site.checks > 0 ? (
                      <Badge tone="neutral">{site.checks} checks recorded</Badge>
                    ) : (
                      <Badge tone="low">no citation checks</Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {plan.pdfExport && site.latest_audit_id ? (
                    <a
                      href={`/api/reports/audit/${site.latest_audit_id}`}
                      className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-ink-800 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
                    >
                      Audit PDF
                    </a>
                  ) : (
                    <span className="rounded-lg bg-ink-50 px-3.5 py-2 text-xs font-medium text-ink-400">
                      Audit PDF
                    </span>
                  )}
                  {plan.pdfExport && site.checks > 0 ? (
                    <a
                      href={`/api/reports/citations/${site.id}`}
                      className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-ink-800 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
                    >
                      Citation PDF
                    </a>
                  ) : (
                    <span className="rounded-lg bg-ink-50 px-3.5 py-2 text-xs font-medium text-ink-400">
                      Citation PDF
                    </span>
                  )}
                  <Link
                    href={`/app/sites/${site.id}`}
                    className="rounded-lg px-3.5 py-2 text-xs font-semibold text-brand-700 transition hover:bg-brand-50"
                  >
                    Open site
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Client share links"
          description={
            plan.shareLinks
              ? 'Read-only pages a client can open without an account. Revoke any time.'
              : 'Available on Growth and Agency.'
          }
        />
        <ShareLinkManager
          links={links as unknown as ShareLinkItem[]}
          sites={sites.map((s) => ({ id: s.id, name: s.name, latest_audit_id: s.latest_audit_id }))}
          enabled={plan.shareLinks}
          appUrl={env.appUrl}
        />
      </Card>

      <Card>
        <CardHeader title="Branding" description="Applied to PDFs and client links." />
        <div className="px-5 py-4">
          <Link href="/app/settings" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
            Edit branding in Settings →
          </Link>
        </div>
      </Card>
    </div>
  );
}
