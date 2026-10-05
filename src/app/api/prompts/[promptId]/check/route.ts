import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { runPromptCheck, type PromptRow } from '@/lib/citations/run';
import { fail, handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/** Run one prompt against its engines now, on demand. */
export async function POST(_req: Request, { params }: { params: Promise<{ promptId: string }> }) {
  try {
    const session = await requireSession();
    const { promptId } = await params;

    const prompt = await sqlOne<PromptRow>`
      SELECT * FROM tracked_prompts
      WHERE id = ${promptId} AND workspace_id = ${session.workspaceId}
    `;
    if (!prompt) return fail('Prompt not found.', 404);

    const results = await runPromptCheck(prompt, session.plan, 'manual');
    if (!results.length) {
      return fail('No engines on your plan are enabled for this prompt.', 402);
    }
    return ok({ results });
  } catch (e) {
    return handleError(e);
  }
}
