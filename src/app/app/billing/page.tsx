import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSessionOrRedirect } from '@/lib/auth/session';
import { sqlOne } from '@/lib/db';
import { PLANS, PLAN_ORDER, formatLimit, type PlanId } from '@/lib/billing/plans';
import { getUsage } from '@/lib/billing/usage';
import { purchasablePlans, stripeConfigured } from '@/lib/billing/stripe';
import { ManageBillingButton, UpgradeButton } from '@/components/UpgradeButton';
import { Badge, Card, CardHeader, Notice, Stat } from '@/components/ui';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string; cancelled?: string }>;
}) {
  const session = await requireSessionOrRedirect();
  const params = await searchParams;
  const plan = PLANS[session.plan];

  const [workspace, auditsUsed, checksUsed] = await Promise.all([
    sqlOne<{
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      current_period_end: string | null;
      plan_status: string;
    }>`
      SELECT stripe_customer_id, stripe_subscription_id, current_period_end, plan_status
      FROM workspaces WHERE id = ${session.workspaceId}
    `,
    getUsage(session.workspaceId, 'audits'),
    getUsage(session.workspaceId, 'citation_checks'),
  ]);

  const billingLive = stripeConfigured();
  const purchasable = new Set(purchasablePlans());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Billing</h1>
        <p className="mt-0.5 text-sm text-ink-500">{session.workspaceName}</p>
      </div>

      {params.upgraded ? (
        <Notice tone="info" title="Checkout complete">
          Your plan updates as soon as Stripe confirms the subscription — usually a few seconds.
          Reload this page if it still shows the old plan.
        </Notice>
      ) : null}
      {params.cancelled ? (
        <Notice tone="warn" title="Checkout cancelled">
          Nothing was charged. Your plan has not changed.
        </Notice>
      ) : null}
      {workspace?.plan_status === 'past_due' ? (
        <Notice tone="danger" title="Your last payment failed">
          Update your card to keep paid features. Your workspace stays on {plan.name} in the
          meantime.
        </Notice>
      ) : null}
      {!billingLive ? (
        <Notice tone="warn" title="Billing is not configured on this deployment">
          Set <code className="font-mono text-xs">STRIPE_SECRET_KEY</code>,{' '}
          <code className="font-mono text-xs">STRIPE_WEBHOOK_SECRET</code> and the plan price IDs
          to enable upgrades. Every plan limit is still enforced, so you can change a workspace&apos;s
          plan directly in the database to test the paid tiers.
        </Notice>
      ) : null}

      <Card>
        <CardHeader
          title="Current plan"
          action={
            <div className="flex items-center gap-2">
              <Badge tone={session.plan === 'free' ? 'neutral' : 'good'}>{plan.name}</Badge>
              {workspace?.stripe_customer_id && billingLive ? <ManageBillingButton /> : null}
            </div>
          }
        />
        <div className="grid divide-y divide-ink-100 sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
          <Stat
            label="Audits this month"
            value={`${auditsUsed} / ${formatLimit(plan.auditsPerMonth)}`}
          />
          <Stat label="Citation checks this month" value={`${checksUsed}`} />
          <Stat
            label="Renews"
            value={
              workspace?.current_period_end
                ? new Date(workspace.current_period_end).toLocaleDateString('en-GB')
                : '—'
            }
            note={session.plan === 'free' ? 'free plan, no renewal' : workspace?.plan_status ?? ''}
          />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-4">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const current = id === session.plan;
          const featured = id === 'growth';
          const paid = id !== 'free';

          return (
            <Card
              key={id}
              className={`flex flex-col p-6 ${current ? 'ring-2 ring-brand-500' : featured ? 'ring-1 ring-brand-200' : ''}`}
            >
              <div className="flex items-baseline justify-between">
                <h2 className="font-bold text-ink-900">{p.name}</h2>
                {current ? <Badge tone="info">Current</Badge> : null}
              </div>
              <p className="mt-1 min-h-[2.5rem] text-xs text-ink-500">{p.tagline}</p>
              <p className="mt-3">
                <span className="text-3xl font-extrabold tracking-tight text-ink-900">
                  £{p.priceGbp}
                </span>
                <span className="text-sm text-ink-500">/mo</span>
              </p>

              <ul className="mt-5 flex-1 space-y-1.5 text-sm text-ink-600">
                <li>{formatLimit(p.sites)} site{p.sites === 1 ? '' : 's'}</li>
                <li>{formatLimit(p.pagesPerAudit)} pages per audit</li>
                <li>{formatLimit(p.auditsPerMonth)} audits / month</li>
                <li>{formatLimit(p.prompts)} tracked prompts</li>
                <li>{p.engines} AI engine{p.engines === 1 ? '' : 's'}</li>
                <li>{formatLimit(p.competitorsPerSite)} competitors / site</li>
                <li className={p.weeklyAutoChecks ? '' : 'text-ink-300 line-through'}>
                  Weekly auto-checks
                </li>
                <li className={p.pdfExport ? '' : 'text-ink-300 line-through'}>PDF export</li>
                <li className={p.whiteLabel ? '' : 'text-ink-300 line-through'}>White-label</li>
                <li className={p.shareLinks ? '' : 'text-ink-300 line-through'}>Client links</li>
                <li className={p.apiAccess ? '' : 'text-ink-300 line-through'}>API + n8n</li>
              </ul>

              {current ? (
                <p className="mt-6 rounded-lg bg-ink-50 px-4 py-2.5 text-center text-sm font-semibold text-ink-500">
                  Your plan
                </p>
              ) : paid ? (
                <UpgradeButton
                  plan={id as Exclude<PlanId, 'free'>}
                  label={
                    PLAN_ORDER.indexOf(id) > PLAN_ORDER.indexOf(session.plan)
                      ? `Upgrade to ${p.name}`
                      : `Switch to ${p.name}`
                  }
                  available={billingLive && purchasable.has(id as Exclude<PlanId, 'free'>)}
                  featured={featured}
                />
              ) : (
                <p className="mt-6 rounded-lg bg-ink-50 px-4 py-2.5 text-center text-xs text-ink-500">
                  Downgrade from the billing portal
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-ink-400">
        Prices in GBP, excluding VAT. Cancel any time from the billing portal — you keep access
        until the end of the period.{' '}
        <Link href="/app/settings" className="underline">
          Workspace settings
        </Link>
      </p>
    </div>
  );
}
