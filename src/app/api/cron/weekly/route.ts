import { sql, sqlOne } from '@/lib/db';
import { env } from '@/lib/env';
import { constantTimeEqual } from '@/lib/auth/session';
import { planOf, type PlanId } from '@/lib/billing/plans';
import { runPromptCheck, type PromptRow } from '@/lib/citations/run';
import { fail, handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Scheduled citation run, called by the n8n webhook at gmkmedia.app.n8n.cloud.
 *
 *   curl -X POST https://<app>/api/cron/weekly \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     -H "Content-Type: application/json" -d '{"workspaceId":"optional"}'
 *
 * Only workspaces on a plan with weekly auto-checks are processed. Each run is recorded
 * in scheduled_runs so a missed week is visible rather than silent.
 */
export async function POST(req: Request) {
  try {
    const expected = env.cronSecret();
    if (!expected) {
      return fail('Scheduled runs are disabled. Set CRON_SECRET to enable them.', 503);
    }

    const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!provided || !constantTimeEqual(provided, expected)) {
      return fail('Unauthorised.', 401);
    }

    let onlyWorkspace: string | null = null;
    let staleHours = 144; // ~6 days, so a weekly schedule never skips itself by an hour
    try {
      const body = (await req.json()) as { workspaceId?: string; staleHours?: number };
      if (typeof body.workspaceId === 'string') onlyWorkspace = body.workspaceId;
      if (typeof body.staleHours === 'number' && body.staleHours >= 0) staleHours = body.staleHours;
    } catch {
      // An empty body is the normal case for a cron ping.
    }

    const workspaces = onlyWorkspace
      ? await sql<{ id: string; plan: PlanId }>`
          SELECT id, plan FROM workspaces
          WHERE id = ${onlyWorkspace} AND plan_status IN ('active', 'trialing')
        `
      : await sql<{ id: string; plan: PlanId }>`
          SELECT id, plan FROM workspaces WHERE plan_status IN ('active', 'trialing')
        `;

    const eligible = workspaces.filter((w) => planOf(w.plan).weeklyAutoChecks);

    const summary: {
      workspaceId: string;
      plan: PlanId;
      promptsRun: number;
      checksWritten: number;
      error?: string;
    }[] = [];

    for (const workspace of eligible) {
      const run = await sqlOne<{ id: string }>`
        INSERT INTO scheduled_runs (workspace_id, kind, status)
        VALUES (${workspace.id}, 'weekly_citations', 'running')
        RETURNING id
      `;

      let promptsRun = 0;
      let checksWritten = 0;
      let error: string | null = null;

      try {
        const prompts = await sql<PromptRow>`
          SELECT * FROM tracked_prompts
          WHERE workspace_id = ${workspace.id} AND is_active = true
            AND (last_checked_at IS NULL
                 OR last_checked_at < now() - (${staleHours} || ' hours')::interval)
          ORDER BY last_checked_at ASC NULLS FIRST
          LIMIT 200
        `;

        for (const prompt of prompts) {
          // One failing prompt must not abandon the rest of the workspace's run.
          try {
            const results = await runPromptCheck(prompt, workspace.plan, 'schedule');
            promptsRun += 1;
            checksWritten += results.length;
          } catch (e) {
            console.error('[cron] prompt failed', prompt.id, e);
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      if (run) {
        await sql`
          UPDATE scheduled_runs SET
            status = ${error ? 'failed' : 'complete'},
            prompts_run = ${promptsRun},
            checks_written = ${checksWritten},
            error = ${error},
            finished_at = now()
          WHERE id = ${run.id}
        `;
      }

      summary.push({
        workspaceId: workspace.id,
        plan: workspace.plan,
        promptsRun,
        checksWritten,
        ...(error ? { error } : {}),
      });
    }

    return ok({
      ran: true,
      workspacesConsidered: workspaces.length,
      workspacesEligible: eligible.length,
      totals: {
        promptsRun: summary.reduce((s, r) => s + r.promptsRun, 0),
        checksWritten: summary.reduce((s, r) => s + r.checksWritten, 0),
      },
      results: summary,
    });
  } catch (e) {
    return handleError(e);
  }
}

/** A GET that reports configuration, so n8n can verify the wiring without running a job. */
export async function GET() {
  return ok({
    endpoint: 'POST /api/cron/weekly',
    auth: 'Authorization: Bearer $CRON_SECRET',
    configured: !!env.cronSecret(),
    n8nWebhook: env.n8nWebhookUrl() || null,
  });
}
