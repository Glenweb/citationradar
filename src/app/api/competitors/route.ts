import { sql, sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { assertCompetitorQuota } from '@/lib/billing/usage';
import { competitorSchema } from '@/lib/validate';
import { fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const siteId = new URL(req.url).searchParams.get('siteId');
    const competitors = siteId
      ? await sql`
          SELECT * FROM competitors
          WHERE workspace_id = ${session.workspaceId} AND site_id = ${siteId}
          ORDER BY name
        `
      : await sql`
          SELECT * FROM competitors WHERE workspace_id = ${session.workspaceId} ORDER BY name
        `;
    return ok({ competitors });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = competitorSchema.parse(await readJson(req));

    const site = await sqlOne<{ id: string }>`
      SELECT id FROM sites WHERE id = ${body.siteId} AND workspace_id = ${session.workspaceId}
    `;
    if (!site) return fail('Site not found.', 404);
    await assertCompetitorQuota(body.siteId, session.plan);

    const duplicate = await sqlOne<{ id: string }>`
      SELECT id FROM competitors WHERE site_id = ${body.siteId} AND name = ${body.name.trim()}
    `;
    if (duplicate) return fail('That competitor is already tracked for this site.', 409);

    const domain = body.domain?.trim()
      ? body.domain.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase()
      : null;

    const competitor = await sqlOne`
      INSERT INTO competitors (workspace_id, site_id, name, domain, aliases)
      VALUES (${session.workspaceId}, ${body.siteId}, ${body.name.trim()}, ${domain},
              ${body.aliases ?? []})
      RETURNING *
    `;
    return ok({ competitor }, 201);
  } catch (e) {
    return handleError(e);
  }
}
