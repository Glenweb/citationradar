import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { fail, handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ competitorId: string }> },
) {
  try {
    const session = await requireSession();
    const { competitorId } = await params;
    const deleted = await sqlOne<{ id: string }>`
      DELETE FROM competitors
      WHERE id = ${competitorId} AND workspace_id = ${session.workspaceId}
      RETURNING id
    `;
    if (!deleted) return fail('Competitor not found.', 404);
    return ok({ deleted: deleted.id });
  } catch (e) {
    return handleError(e);
  }
}
