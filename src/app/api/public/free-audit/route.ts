import { startAudit, freeAuditsToday } from '@/lib/aeo/run';
import { freeAuditSchema } from '@/lib/validate';
import { clientIp, fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Anonymous audits per IP per rolling 24h. The acquisition funnel, not a free tier. */
const DAILY_LIMIT = 5;

export async function POST(req: Request) {
  try {
    const body = freeAuditSchema.parse(await readJson(req));
    const ip = clientIp(req);

    const used = await freeAuditsToday(ip);
    if (used >= DAILY_LIMIT) {
      return fail(
        `You have used all ${DAILY_LIMIT} free audits for today. Create an account to keep going.`,
        429,
        { limit: DAILY_LIMIT, used },
      );
    }

    const audit = await startAudit({
      targetUrl: body.url,
      scope: 'single_url',
      maxPages: 1,
      ip,
    });

    if (audit.status === 'failed') {
      return fail(audit.error ?? 'That URL could not be audited.', 422, {
        publicId: audit.public_id,
      });
    }

    return ok(
      {
        publicId: audit.public_id,
        score: audit.overall_score,
        grade: audit.grade,
        remaining: Math.max(0, DAILY_LIMIT - used - 1),
      },
      201,
    );
  } catch (e) {
    return handleError(e);
  }
}
