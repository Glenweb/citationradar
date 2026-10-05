import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { planOf } from '@/lib/billing/plans';
import { buildCitationReport } from '@/lib/pdf/report';
import { brandingFor, buildCitationReportData, loadWorkspace, reportFilename } from '@/lib/reports';
import { fail, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const session = await requireSession();
    const { siteId } = await params;

    if (!planOf(session.plan).pdfExport) {
      return fail('PDF export is available on the Starter plan and above.', 402, {
        upgradeTo: 'starter',
      });
    }

    const owned = await sqlOne<{ id: string }>`
      SELECT id FROM sites WHERE id = ${siteId} AND workspace_id = ${session.workspaceId}
    `;
    if (!owned) return fail('Site not found.', 404);

    const [data, workspace] = await Promise.all([
      buildCitationReportData(siteId),
      loadWorkspace(session.workspaceId),
    ]);
    if (!data) return fail('Site not found.', 404);
    if (!workspace) return fail('Workspace not found.', 404);
    if (!data.visibility.checks) {
      return fail('Run at least one citation check before exporting this report.', 409);
    }

    const pdf = buildCitationReport(data, brandingFor(workspace));
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${reportFilename('ai-citations', data.site.name)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
