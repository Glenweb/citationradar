import { getSession } from '@/lib/auth/session';
import { planOf } from '@/lib/billing/plans';
import { handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return ok({ signedIn: false });
    return ok({
      signedIn: true,
      user: { id: session.userId, email: session.email, name: session.name },
      workspace: {
        id: session.workspaceId,
        name: session.workspaceName,
        slug: session.workspaceSlug,
        plan: session.plan,
        planStatus: session.planStatus,
        limits: planOf(session.plan),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
