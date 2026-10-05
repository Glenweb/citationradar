import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { planOf } from '@/lib/billing/plans';
import { buildAuditReport } from '@/lib/pdf/report';
import { brandingFor, buildAuditReportData, loadWorkspace, reportFilename } from '@/lib/reports';
import { fail, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ auditId: string }> }) {
  try {
    const session = await requireSession();
    const { auditId } = await params;

    if (!planOf(session.plan).pdfExport) {
      return fail('PDF export is available on the Starter plan and above.', 402, {
        upgradeTo: 'starter',
      });
    }

    const owned = await sqlOne<{ id: string }>`
      SELECT id FROM audits WHERE id = ${auditId} AND workspace_id = ${session.workspaceId}
    `;
    if (!owned) return fail('Audit not found.', 404);

    const [data, workspace] = await Promise.all([
      buildAuditReportData(auditId),
      loadWorkspace(session.workspaceId),
    ]);
    if (!data) return fail('That audit has not finished successfully yet.', 409);
    if (!workspace) return fail('Workspace not found.', 404);

    const pdf = buildAuditReport(data, brandingFor(workspace));
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${reportFilename('aeo-audit', data.site.name)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
