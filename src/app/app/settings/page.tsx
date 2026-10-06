import type { Metadata } from 'next';
import { requireSessionOrRedirect } from '@/lib/auth/session';
import { sqlOne, activeDriver } from '@/lib/db';
import { env } from '@/lib/env';
import { ENGINE_LABELS, PLANS, type EngineId } from '@/lib/billing/plans';
import { engineStatus } from '@/lib/citations';
import { anthropicConfigured } from '@/lib/aeo/recommend';
import { stripeConfigured } from '@/lib/billing/stripe';
import { BrandingForm, type Branding } from '@/components/BrandingForm';
import { Badge, Card, CardHeader, CodeBlock, Notice } from '@/components/ui';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireSessionOrRedirect();
  const plan = PLANS[session.plan];

  const workspace = await sqlOne<Branding>`
    SELECT name, brand_name, brand_logo_url, brand_colour, brand_footer, brand_contact
    FROM workspaces WHERE id = ${session.workspaceId}
  `;

  const engines = engineStatus();
  const cronEnabled = !!env.cronSecret();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {session.email} · {session.role} of {session.workspaceName}
        </p>
      </div>

      <Card>
        <CardHeader
          title="Report branding"
          description="Applied to PDF exports and client share links."
        />
        {workspace ? (
          <BrandingForm workspace={workspace} whiteLabelEnabled={plan.whiteLabel} />
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Engine status"
          description="Engines without credentials return deterministic simulated data, labelled as such everywhere."
        />
        <ul className="divide-y divide-ink-100">
          {engines.map((e) => (
            <li key={e.engine} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">
                  {ENGINE_LABELS[e.engine as EngineId]}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {e.configured
                    ? 'Live — real API calls'
                    : `Simulated — set ${e.requires.join(' and ')} to go live`}
                </p>
              </div>
              <Badge tone={e.configured ? 'good' : 'medium'}>
                {e.configured ? 'Live' : 'Simulated'}
              </Badge>
            </li>
          ))}
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900">Fix recommendations</p>
              <p className="mt-0.5 text-xs text-ink-500">
                {anthropicConfigured()
                  ? 'Claude tailors the summary and action plan to each site.'
                  : 'Set ANTHROPIC_API_KEY for Claude-tailored copy. Reports use built-in copy derived from the same findings until then.'}
              </p>
            </div>
            <Badge tone={anthropicConfigured() ? 'good' : 'neutral'}>
              {anthropicConfigured() ? 'Claude' : 'Built-in copy'}
            </Badge>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900">Audits and scoring</p>
              <p className="mt-0.5 text-xs text-ink-500">
                Always real — crawling needs no API key. Database driver:{' '}
                <span className="font-mono">{activeDriver()}</span>
              </p>
            </div>
            <Badge tone="good">Live</Badge>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900">Billing</p>
              <p className="mt-0.5 text-xs text-ink-500">
                {stripeConfigured()
                  ? 'Stripe is connected.'
                  : 'Set STRIPE_SECRET_KEY to enable upgrades. Plan limits are enforced regardless.'}
              </p>
            </div>
            <Badge tone={stripeConfigured() ? 'good' : 'neutral'}>
              {stripeConfigured() ? 'Live' : 'Disabled'}
            </Badge>
          </li>
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Scheduled weekly checks"
          description="Driven by an n8n webhook so you can wire it into your own workflows."
        />
        <div className="space-y-4 p-5">
          {!plan.weeklyAutoChecks ? (
            <Notice tone="warn" title="Weekly auto-checks need a paid plan">
              The scheduler skips free workspaces. Upgrade to Starter or above to be included.
            </Notice>
          ) : cronEnabled ? (
            <Notice tone="info" title="This workspace is included in scheduled runs">
              Any prompt not checked in the last 6 days is re-run when the schedule fires.
            </Notice>
          ) : (
            <Notice tone="warn" title="Scheduled runs are disabled on this deployment">
              Set <code className="font-mono text-xs">CRON_SECRET</code> to enable the endpoint.
            </Notice>
          )}

          <div>
            <p className="text-sm font-medium text-ink-700">Set up in n8n</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-600">
              <li>Add a <strong>Schedule Trigger</strong> node — weekly, Monday 07:00.</li>
              <li>
                Add an <strong>HTTP Request</strong> node: POST to the URL below, with an{' '}
                <code className="font-mono text-xs">Authorization</code> header of{' '}
                <code className="font-mono text-xs">Bearer &lt;CRON_SECRET&gt;</code>.
              </li>
              <li>
                Optionally send <code className="font-mono text-xs">{'{"workspaceId": "…"}'}</code>{' '}
                to run one workspace only.
              </li>
            </ol>
          </div>

          <CodeBlock>{`curl -X POST ${env.appUrl}/api/cron/weekly \\
  -H "Authorization: Bearer $CRON_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"workspaceId": "${session.workspaceId}"}'`}</CodeBlock>

          <p className="text-xs text-ink-500">
            Webhook configured for this deployment:{' '}
            <span className="font-mono">{env.n8nWebhookUrl() || 'none'}</span>. A{' '}
            <code className="font-mono">GET</code> on the same endpoint reports whether the
            scheduler is configured, without running a job.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Workspace" />
        <dl className="divide-y divide-ink-100 text-sm">
          {[
            ['Workspace ID', session.workspaceId],
            ['Plan', `${plan.name} (£${plan.priceGbp}/mo)`],
            ['Your role', session.role],
            ['Signed in as', session.email],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <dt className="text-ink-500">{label}</dt>
              <dd className="font-mono text-xs text-ink-800">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
