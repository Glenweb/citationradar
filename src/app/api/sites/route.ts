import { sql, sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { assertSiteQuota } from '@/lib/billing/usage';
import { assertSafeUrl } from '@/lib/crawl/fetcher';
import { parseSiteUrl, siteSchema } from '@/lib/validate';
import { fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireSession();
    const sites = await sql`
      SELECT s.*,
        (SELECT overall_score FROM audits a
          WHERE a.site_id = s.id AND a.status = 'complete'
          ORDER BY a.completed_at DESC LIMIT 1) AS latest_score,
        (SELECT completed_at FROM audits a
          WHERE a.site_id = s.id AND a.status = 'complete'
          ORDER BY a.completed_at DESC LIMIT 1) AS latest_audit_at,
        (SELECT count(*)::int FROM tracked_prompts p WHERE p.site_id = s.id) AS prompt_count,
        (SELECT count(*)::int FROM competitors c WHERE c.site_id = s.id) AS competitor_count
      FROM sites s
      WHERE s.workspace_id = ${session.workspaceId}
      ORDER BY s.created_at ASC
    `;
    return ok({ sites });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = siteSchema.parse(await readJson(req));

    const { origin, domain } = parseSiteUrl(body.url);
    // Confirm the host is public and resolvable before storing it.
    await assertSafeUrl(origin);

    // Checked before the quota, because re-adding an existing site is not a capacity
    // problem and "upgrade your plan" would be a misleading answer to it.
    const duplicate = await sqlOne<{ id: string }>`
      SELECT id FROM sites WHERE workspace_id = ${session.workspaceId} AND origin = ${origin}
    `;
    if (duplicate) return fail('That site is already in this workspace.', 409);

    await assertSiteQuota(session.workspaceId, session.plan);

    const site = await sqlOne`
      INSERT INTO sites (workspace_id, origin, domain, name, brand_name, brand_aliases)
      VALUES (${session.workspaceId}, ${origin}, ${domain},
              ${body.name?.trim() || domain}, ${body.brandName.trim()},
              ${body.brandAliases ?? []})
      RETURNING *
    `;
    return ok({ site }, 201);
  } catch (e) {
    return handleError(e);
  }
}
