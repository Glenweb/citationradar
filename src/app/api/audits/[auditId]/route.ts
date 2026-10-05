import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { getAuditIssues, getAuditPages, type AuditRecord } from '@/lib/aeo/run';
import { fail, handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ auditId: string }> }) {
  try {
    const session = await requireSession();
    const { auditId } = await params;

    const audit = await sqlOne<AuditRecord & { site_name: string | null }>`
      SELECT a.*, s.name AS site_name FROM audits a
      LEFT JOIN sites s ON s.id = a.site_id
      WHERE a.id = ${auditId} AND a.workspace_id = ${session.workspaceId}
    `;
    if (!audit) return fail('Audit not found.', 404);

    const [issues, pages] = await Promise.all([getAuditIssues(auditId), getAuditPages(auditId)]);
    return ok({ audit, issues, pages });
  } catch (e) {
    return handleError(e);
  }
}
