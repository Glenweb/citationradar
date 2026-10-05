import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import {
  competitorBenchmark,
  currentVisibility,
  latestChecks,
  visibilityHistory,
} from '@/lib/citations/run';
import { fail, handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Everything the tracker and benchmark views need for one site, in one round trip. */
export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const siteId = url.searchParams.get('siteId');
    if (!siteId) return fail('siteId is required.', 400);

    const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days') ?? 90) || 90));

    const site = await sqlOne<{ id: string }>`
      SELECT id FROM sites WHERE id = ${siteId} AND workspace_id = ${session.workspaceId}
    `;
    if (!site) return fail('Site not found.', 404);

    const [visibility, latest, history, benchmark] = await Promise.all([
      currentVisibility(siteId),
      latestChecks(siteId),
      visibilityHistory(siteId, days),
      competitorBenchmark(siteId),
    ]);

    return ok({ visibility, latest, history, benchmark });
  } catch (e) {
    return handleError(e);
  }
}
