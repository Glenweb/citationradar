import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { createPortalSession, stripeConfigured } from '@/lib/billing/stripe';
import { fail, handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await requireSession();
    if (!stripeConfigured()) return fail('Billing is not configured on this deployment.', 503);
    if (session.role !== 'owner') {
      return fail('Only the workspace owner can manage billing.', 403);
    }

    const workspace = await sqlOne<{ stripe_customer_id: string | null }>`
      SELECT stripe_customer_id FROM workspaces WHERE id = ${session.workspaceId}
    `;
    if (!workspace?.stripe_customer_id) {
      return fail('No billing account yet — upgrade to a paid plan first.', 409);
    }

    const { url } = await createPortalSession({ customerId: workspace.stripe_customer_id });
    return ok({ url });
  } catch (e) {
    return handleError(e);
  }
}
