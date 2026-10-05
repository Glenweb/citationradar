import type Stripe from 'stripe';
import { sql } from '@/lib/db';
import { env } from '@/lib/env';
import { getStripe, recordEvent, stripeConfigured, syncSubscription } from '@/lib/billing/stripe';
import { fail, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Stripe webhook. The signature is verified against the raw body before anything is
 * parsed, and every event id is recorded so a replay is a no-op.
 */
export async function POST(req: Request) {
  if (!stripeConfigured()) return fail('Billing is not configured.', 503);

  const secret = env.stripeWebhookSecret();
  if (!secret) return fail('STRIPE_WEBHOOK_SECRET is not set.', 503);

  const signature = req.headers.get('stripe-signature');
  if (!signature) return fail('Missing stripe-signature header.', 400);

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(raw, signature, secret);
  } catch (e) {
    return fail(`Signature verification failed: ${e instanceof Error ? e.message : 'unknown'}`, 400);
  }

  const fresh = await recordEvent(event.id, event.type);
  if (!fresh) return ok({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const workspaceId = s.client_reference_id ?? s.metadata?.workspace_id;
        const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;

        // Attach the customer immediately so the portal works even before the
        // subscription event lands.
        if (workspaceId && customerId) {
          await sql`
            UPDATE workspaces SET stripe_customer_id = ${customerId}, updated_at = now()
            WHERE id = ${workspaceId}
          `;
        }
        if (s.subscription) {
          const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription.id;
          const sub = await getStripe().subscriptions.retrieve(subId);
          await syncSubscription({
            ...(sub as unknown as Record<string, unknown>),
            metadata: { ...(sub.metadata ?? {}), ...(workspaceId ? { workspace_id: workspaceId } : {}) },
          } as never);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object as never);
        break;

      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
        if (customerId) {
          await sql`
            UPDATE workspaces SET plan_status = 'past_due', updated_at = now()
            WHERE stripe_customer_id = ${customerId}
          `;
        }
        break;
      }

      default:
        break;
    }
    return ok({ received: true, type: event.type });
  } catch (e) {
    console.error('[stripe webhook]', event.type, e);
    // 500 so Stripe retries a handler failure; the event ledger makes the retry safe.
    return fail('Webhook handler failed.', 500);
  }
}
