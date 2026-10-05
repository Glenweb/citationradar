import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { planOf } from '@/lib/billing/plans';
import { getUsage } from '@/lib/billing/usage';
import { engineStatus } from '@/lib/citations';
import { anthropicConfigured } from '@/lib/aeo/recommend';
import { stripeConfigured, purchasablePlans } from '@/lib/billing/stripe';
import { brandingSchema } from '@/lib/validate';
import { fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireSession();
    const workspace = await sqlOne`
      SELECT * FROM workspaces WHERE id = ${session.workspaceId}
    `;
    if (!workspace) return fail('Workspace not found.', 404);

    const [audits, checks] = await Promise.all([
      getUsage(session.workspaceId, 'audits'),
      getUsage(session.workspaceId, 'citation_checks'),
    ]);

    return ok({
      workspace,
      limits: planOf(session.plan),
      usage: { audits, citationChecks: checks },
      integrations: {
        engines: engineStatus(),
        recommendations: anthropicConfigured(),
        billing: stripeConfigured(),
        purchasablePlans: purchasablePlans(),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireSession();
    if (session.role !== 'owner') {
      return fail('Only the workspace owner can change these settings.', 403);
    }
    const body = brandingSchema.parse(await readJson(req));

    const workspace = await sqlOne`
      UPDATE workspaces SET
        name           = coalesce(${body.name ?? null}, name),
        brand_name     = CASE WHEN ${body.brandName !== undefined}
                           THEN ${body.brandName ?? null} ELSE brand_name END,
        brand_logo_url = CASE WHEN ${body.brandLogoUrl !== undefined}
                           THEN ${body.brandLogoUrl ?? null} ELSE brand_logo_url END,
        brand_colour   = coalesce(${body.brandColour ?? null}, brand_colour),
        brand_footer   = CASE WHEN ${body.brandFooter !== undefined}
                           THEN ${body.brandFooter ?? null} ELSE brand_footer END,
        brand_contact  = CASE WHEN ${body.brandContact !== undefined}
                           THEN ${body.brandContact ?? null} ELSE brand_contact END,
        updated_at = now()
      WHERE id = ${session.workspaceId}
      RETURNING *
    `;
    return ok({ workspace });
  } catch (e) {
    return handleError(e);
  }
}
