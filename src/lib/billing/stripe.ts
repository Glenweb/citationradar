import 'server-only';
import Stripe from 'stripe';
import { env } from '../env';
import { sql, sqlOne } from '../db';
import { PLANS, type PlanId } from './plans';

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return !!env.stripeSecret();
}

export function getStripe(): Stripe {
  if (!stripeConfigured()) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing.');
  }
  if (!client) client = new Stripe(env.stripeSecret());
  return client;
}

/** Which paid plans have a price id configured — the rest are shown as unavailable. */
export function purchasablePlans(): PlanId[] {
  return (['starter', 'growth', 'agency'] as const).filter((p) => !!env.stripePrice(p));
}

export async function createCheckoutSession(opts: {
  workspaceId: string;
  workspaceName: string;
  plan: Exclude<PlanId, 'free'>;
  email: string;
  existingCustomerId: string | null;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  const price = env.stripePrice(opts.plan);
  if (!price) throw new Error(`No Stripe price configured for the ${opts.plan} plan.`);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: `${env.appUrl}/app/billing?upgraded=${opts.plan}`,
    cancel_url: `${env.appUrl}/app/billing?cancelled=1`,
    ...(opts.existingCustomerId
      ? { customer: opts.existingCustomerId }
      : { customer_email: opts.email }),
    client_reference_id: opts.workspaceId,
    // The workspace id is the join key the webhook uses; without it a completed
    // checkout cannot be attributed.
    subscription_data: { metadata: { workspace_id: opts.workspaceId, plan: opts.plan } },
    metadata: { workspace_id: opts.workspaceId, plan: opts.plan },
    allow_promotion_codes: true,
  });

  if (!session.url) throw new Error('Stripe did not return a checkout URL.');
  return { url: session.url };
}

export async function createPortalSession(opts: {
  customerId: string;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: opts.customerId,
    return_url: `${env.appUrl}/app/billing`,
  });
  return { url: session.url };
}

/** Map a Stripe price id back to our plan. */
export function planForPrice(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const plan of ['starter', 'growth', 'agency'] as const) {
    if (env.stripePrice(plan) === priceId) return plan;
  }
  return null;
}

type SubscriptionLike = {
  id: string;
  customer: string | { id: string };
  status: string;
  items?: { data?: { price?: { id?: string } }[] };
  metadata?: Record<string, string>;
  current_period_end?: number;
};

/**
 * Apply a subscription's state to the workspace. Called from the webhook for
 * created/updated/deleted; idempotent, so a replayed event is harmless.
 */
export async function syncSubscription(sub: SubscriptionLike): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const priceId = sub.items?.data?.[0]?.price?.id;
  const metaPlan = sub.metadata?.plan as PlanId | undefined;
  const plan = planForPrice(priceId) ?? (metaPlan && metaPlan in PLANS ? metaPlan : null);

  const workspaceId =
    sub.metadata?.workspace_id ??
    (customerId
      ? (
          await sqlOne<{ id: string }>`
            SELECT id FROM workspaces WHERE stripe_customer_id = ${customerId} LIMIT 1
          `
        )?.id
      : undefined);

  if (!workspaceId) return;

  // A cancelled or unpaid subscription drops the workspace back to free rather than
  // leaving paid limits in place.
  const terminal = ['canceled', 'incomplete_expired', 'unpaid'].includes(sub.status);
  const effectivePlan: PlanId = terminal ? 'free' : (plan ?? 'free');
  const planStatus =
    sub.status === 'active' || sub.status === 'trialing'
      ? sub.status === 'trialing'
        ? 'trialing'
        : 'active'
      : sub.status === 'past_due'
        ? 'past_due'
        : terminal
          ? 'canceled'
          : 'active';

  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  await sql`
    UPDATE workspaces SET
      plan = ${effectivePlan},
      plan_status = ${planStatus},
      stripe_customer_id = coalesce(${customerId ?? null}, stripe_customer_id),
      stripe_subscription_id = ${terminal ? null : sub.id},
      current_period_end = ${periodEnd},
      updated_at = now()
    WHERE id = ${workspaceId}
  `;
}

/** Record an event id so a replay is a no-op. Returns false if already seen. */
export async function recordEvent(id: string, type: string): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    INSERT INTO stripe_events (id, type) VALUES (${id}, ${type})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}
