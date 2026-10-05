import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { fail, handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Revoking keeps the row (so view counts survive) but kills the URL. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ linkId: string }> }) {
  try {
    const session = await requireSession();
    const { linkId } = await params;
    const revoked = await sqlOne<{ id: string }>`
      UPDATE share_links SET revoked_at = now()
      WHERE id = ${linkId} AND workspace_id = ${session.workspaceId} AND revoked_at IS NULL
      RETURNING id
    `;
    if (!revoked) return fail('Share link not found, or already revoked.', 404);
    return ok({ revoked: revoked.id });
  } catch (e) {
    return handleError(e);
  }
}
