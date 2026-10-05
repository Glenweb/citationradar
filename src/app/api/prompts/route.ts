import { sql, sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { enginesForPlan, type EngineId } from '@/lib/billing/plans';
import { assertPromptQuota } from '@/lib/billing/usage';
import { promptSchema } from '@/lib/validate';
import { fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const siteId = new URL(req.url).searchParams.get('siteId');

    const prompts = siteId
      ? await sql`
          SELECT p.*, s.name AS site_name FROM tracked_prompts p
          JOIN sites s ON s.id = p.site_id
          WHERE p.workspace_id = ${session.workspaceId} AND p.site_id = ${siteId}
          ORDER BY p.created_at ASC
        `
      : await sql`
          SELECT p.*, s.name AS site_name FROM tracked_prompts p
          JOIN sites s ON s.id = p.site_id
          WHERE p.workspace_id = ${session.workspaceId}
          ORDER BY p.created_at ASC
        `;
    return ok({ prompts });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = promptSchema.parse(await readJson(req));
    await assertPromptQuota(session.workspaceId, session.plan);

    const site = await sqlOne<{ id: string }>`
      SELECT id FROM sites WHERE id = ${body.siteId} AND workspace_id = ${session.workspaceId}
    `;
    if (!site) return fail('Site not found.', 404);

    // Silently narrowing to the plan's engines would make the UI lie about what is
    // tracked, so an out-of-plan engine is rejected explicitly.
    const allowed = enginesForPlan(session.plan);
    const requested = (body.engines as EngineId[] | undefined) ?? allowed;
    const disallowed = requested.filter((e) => !allowed.includes(e));
    if (disallowed.length) {
      return fail(
        `Your plan tracks ${allowed.length} engine${allowed.length === 1 ? '' : 's'}. Upgrade to track ${disallowed.join(', ')}.`,
        402,
        { allowed, disallowed },
      );
    }

    const duplicate = await sqlOne<{ id: string }>`
      SELECT id FROM tracked_prompts
      WHERE site_id = ${body.siteId} AND prompt = ${body.prompt.trim()}
        AND locale = ${body.locale ?? 'en-GB'}
    `;
    if (duplicate) return fail('That prompt is already tracked for this site.', 409);

    const prompt = await sqlOne`
      INSERT INTO tracked_prompts (workspace_id, site_id, prompt, intent, locale, engines)
      VALUES (${session.workspaceId}, ${body.siteId}, ${body.prompt.trim()},
              ${body.intent ?? null}, ${body.locale ?? 'en-GB'}, ${requested})
      RETURNING *
    `;
    return ok({ prompt }, 201);
  } catch (e) {
    return handleError(e);
  }
}
