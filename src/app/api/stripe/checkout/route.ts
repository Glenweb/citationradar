import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { createCheckoutSession, stripeConfigured } from '@/lib/billing/stripe';
import { checkoutSchema } from '@/lib/validate';
import { fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!stripeConfigured()) {
      return fail(
        'Billing is not configured on this deployment. Set STRIPE_SECRET_KEY and the plan price IDs to enable upgrades.',
        503,
      );
    }
    if (session.role !== 'owner') {
      return fail('Only the workspace owner can change the plan.', 403);
    }

    const body = checkoutSchema.parse(await readJson(req));
    const workspace = await sqlOne<{
      id: string;
      name: string;
      stripe_customer_id: string | null;
    }>`SELECT id, name, stripe_customer_id FROM workspaces WHERE id = ${session.workspaceId}`;
    if (!workspace) return fail('Workspace not found.', 404);

    const { url } = await createCheckoutSession({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      plan: body.plan,
      email: session.email,
      existingCustomerId: workspace.stripe_customer_id,
    });
    return ok({ url });
  } catch (e) {
    return handleError(e);
  }
}
