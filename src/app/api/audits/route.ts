import { sql, sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { planOf } from '@/lib/billing/plans';
import { assertAuditQuota, incrementUsage } from '@/lib/billing/usage';
import { startAudit } from '@/lib/aeo/run';
import { auditSchema } from '@/lib/validate';
import { clientIp, fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';
// A full crawl is slow by nature; give it room before the platform cuts it off.
export const maxDuration = 300;

export async function GET() {
  try {
    const session = await requireSession();
    const audits = await sql`
      SELECT a.id, a.public_id, a.status, a.overall_score, a.previous_score, a.grade,
             a.pages_crawled, a.started_at, a.completed_at, a.error,
             s.name AS site_name, s.origin AS site_origin, s.id AS site_id
      FROM audits a
      LEFT JOIN sites s ON s.id = a.site_id
      WHERE a.workspace_id = ${session.workspaceId}
      ORDER BY a.started_at DESC LIMIT 50
    `;
    return ok({ audits });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = auditSchema.parse(await readJson(req));
    await assertAuditQuota(session.workspaceId, session.plan);

    const site = await sqlOne<{
      id: string;
      origin: string;
      brand_name: string;
    }>`
      SELECT id, origin, brand_name FROM sites
      WHERE id = ${body.siteId} AND workspace_id = ${session.workspaceId}
    `;
    if (!site) return fail('Site not found.', 404);

    const planCap = planOf(session.plan).pagesPerAudit;
    const maxPages = Math.min(body.maxPages ?? planCap, planCap);

    // Counted up front so a long-running crawl cannot be used to overrun the quota
    // by firing several requests at once.
    await incrementUsage(session.workspaceId, 'audits');

    const audit = await startAudit({
      targetUrl: site.origin,
      scope: 'site',
      maxPages,
      workspaceId: session.workspaceId,
      siteId: site.id,
      brandName: site.brand_name,
      ip: clientIp(req),
    });

    return ok({ audit }, 201);
  } catch (e) {
    return handleError(e);
  }
}
