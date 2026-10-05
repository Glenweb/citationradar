import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { enginesForPlan, type EngineId } from '@/lib/billing/plans';
import { promptHistory } from '@/lib/citations/run';
import { promptUpdateSchema } from '@/lib/validate';
import { fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ promptId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { promptId } = await params;
    const prompt = await sqlOne`
      SELECT * FROM tracked_prompts
      WHERE id = ${promptId} AND workspace_id = ${session.workspaceId}
    `;
    if (!prompt) return fail('Prompt not found.', 404);
    return ok({ prompt, history: await promptHistory(promptId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { promptId } = await params;
    const body = promptUpdateSchema.parse(await readJson(req));

    if (body.engines) {
      const allowed = enginesForPlan(session.plan);
      const disallowed = (body.engines as EngineId[]).filter((e) => !allowed.includes(e));
      if (disallowed.length) {
        return fail(`Your plan does not include ${disallowed.join(', ')}.`, 402, { allowed });
      }
    }

    const prompt = await sqlOne`
      UPDATE tracked_prompts SET
        prompt = coalesce(${body.prompt ?? null}, prompt),
        intent = CASE WHEN ${body.intent !== undefined} THEN ${body.intent ?? null} ELSE intent END,
        engines = coalesce(${body.engines ?? null}, engines),
        is_active = coalesce(${body.isActive ?? null}, is_active)
      WHERE id = ${promptId} AND workspace_id = ${session.workspaceId}
      RETURNING *
    `;
    if (!prompt) return fail('Prompt not found.', 404);
    return ok({ prompt });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { promptId } = await params;
    const deleted = await sqlOne<{ id: string }>`
      DELETE FROM tracked_prompts
      WHERE id = ${promptId} AND workspace_id = ${session.workspaceId}
      RETURNING id
    `;
    if (!deleted) return fail('Prompt not found.', 404);
    return ok({ deleted: deleted.id });
  } catch (e) {
    return handleError(e);
  }
}
