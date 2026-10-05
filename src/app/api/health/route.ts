import { dbHealthy } from '@/lib/db';
import { engineStatus } from '@/lib/citations';
import { anthropicConfigured } from '@/lib/aeo/recommend';
import { stripeConfigured } from '@/lib/billing/stripe';
import { env } from '@/lib/env';
import { ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await dbHealthy();
  return ok(
    {
      status: db.ok ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      database: db,
      providers: {
        engines: engineStatus(),
        recommendations: anthropicConfigured() ? 'live' : 'static fallback',
        billing: stripeConfigured() ? 'live' : 'disabled',
        scheduledRuns: env.cronSecret() ? 'enabled' : 'disabled (set CRON_SECRET)',
      },
    },
    db.ok ? 200 : 503,
  );
}
