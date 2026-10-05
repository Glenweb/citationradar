import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { issueStatusSchema } from '@/lib/validate';
import { fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Mark a fix in progress, done or deliberately ignored — the report is a work queue. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ auditId: string; issueId: string }> },
) {
  try {
    const session = await requireSession();
    const { auditId, issueId } = await params;
    const body = issueStatusSchema.parse(await readJson(req));

    const updated = await sqlOne<{ id: string; status: string }>`
      UPDATE audit_issues SET status = ${body.status}
      WHERE id = ${issueId} AND audit_id = ${auditId}
        AND workspace_id = ${session.workspaceId}
      RETURNING id, status
    `;
    if (!updated) return fail('Issue not found.', 404);
    return ok({ issue: updated });
  } catch (e) {
    return handleError(e);
  }
}
