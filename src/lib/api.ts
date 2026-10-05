import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { Unauthorized } from './auth/session';
import { PlanLimitError } from './billing/usage';
import { UnsafeUrlError } from './crawl/fetcher';

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * One place that turns a thrown domain error into the right status code, so route
 * handlers can stay linear instead of branching on every failure mode.
 */
export function handleError(e: unknown): NextResponse {
  if (e instanceof Unauthorized) return fail('Sign in to continue.', 401);
  if (e instanceof PlanLimitError) {
    return fail(e.message, 402, { limit: e.limit, used: e.used, upgradeTo: e.upgradeTo });
  }
  if (e instanceof UnsafeUrlError) return fail(e.message, 422);
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return fail(
      first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input.',
      422,
      { issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    );
  }
  if (e instanceof SyntaxError) return fail('Request body must be valid JSON.', 400);

  const message = e instanceof Error ? e.message : String(e);
  // Surface configuration mistakes rather than hiding them behind a generic 500.
  if (/Missing required environment variable|SESSION_SECRET/.test(message)) {
    return fail(message, 503);
  }
  console.error('[api]', e);
  return fail('Something went wrong on our side.', 500);
}

/** Client IP, trusting the proxy headers Vercel sets. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip') ?? '0.0.0.0';
}

export async function readJson<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}
