import { sql, sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { siteUpdateSchema } from '@/lib/validate';
import { fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ siteId: string }> };

/** Every site lookup filters by the session's workspace — tenancy is never from the URL. */
async function loadSite(siteId: string, workspaceId: string) {
  return sqlOne`SELECT * FROM sites WHERE id = ${siteId} AND workspace_id = ${workspaceId}`;
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { siteId } = await params;
    const site = await loadSite(siteId, session.workspaceId);
    if (!site) return fail('Site not found.', 404);

    const [audits, prompts, competitors] = await Promise.all([
      sql`
        SELECT id, public_id, status, overall_score, previous_score, grade, pages_crawled,
               started_at, completed_at
        FROM audits WHERE site_id = ${siteId}
        ORDER BY started_at DESC LIMIT 20
      `,
      sql`SELECT * FROM tracked_prompts WHERE site_id = ${siteId} ORDER BY created_at ASC`,
      sql`SELECT * FROM competitors WHERE site_id = ${siteId} ORDER BY name ASC`,
    ]);

    return ok({ site, audits, prompts, competitors });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { siteId } = await params;
    const body = siteUpdateSchema.parse(await readJson(req));

    const site = await sqlOne`
      UPDATE sites SET
        name = coalesce(${body.name ?? null}, name),
        brand_name = coalesce(${body.brandName ?? null}, brand_name),
        brand_aliases = coalesce(${body.brandAliases ?? null}, brand_aliases)
      WHERE id = ${siteId} AND workspace_id = ${session.workspaceId}
      RETURNING *
    `;
    if (!site) return fail('Site not found.', 404);
    return ok({ site });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { siteId } = await params;
    const deleted = await sqlOne<{ id: string }>`
      DELETE FROM sites WHERE id = ${siteId} AND workspace_id = ${session.workspaceId}
      RETURNING id
    `;
    if (!deleted) return fail('Site not found.', 404);
    return ok({ deleted: deleted.id });
  } catch (e) {
    return handleError(e);
  }
}
