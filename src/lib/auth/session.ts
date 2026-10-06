import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sql, sqlOne } from '../db';
import { isProd } from '../env';

export const SESSION_COOKIE = 'cr_session';
const TTL_DAYS = 30;

export type SessionUser = {
  userId: string;
  email: string;
  name: string | null;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  plan: 'free' | 'starter' | 'growth' | 'agency';
  planStatus: string;
  role: 'owner' | 'member';
};

/** Tokens are random; only their SHA-256 is stored, so a DB leak can't mint sessions. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + TTL_DAYS * 86_400_000);
  await sql`
    INSERT INTO sessions (user_id, token_hash, user_agent, expires_at)
    VALUES (${userId}, ${hashToken(token)}, ${userAgent ?? null}, ${expires.toISOString()})
  `;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    expires,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * Resolve the current session to a user + their workspace, or null.
 * The workspace comes from the session, never from the request — that is the
 * single place tenancy is decided.
 */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await sqlOne<{
    user_id: string;
    email: string;
    name: string | null;
    workspace_id: string;
    workspace_name: string;
    workspace_slug: string;
    plan: SessionUser['plan'];
    plan_status: string;
    role: 'owner' | 'member';
  }>`
    SELECT u.id AS user_id, u.email, u.name,
           w.id AS workspace_id, w.name AS workspace_name, w.slug AS workspace_slug,
           w.plan, w.plan_status, m.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN workspace_members m ON m.user_id = u.id
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE s.token_hash = ${hashToken(token)}
      AND s.expires_at > now()
    ORDER BY (m.role = 'owner') DESC, w.created_at ASC
    LIMIT 1
  `;
  if (!row) return null;

  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    plan: row.plan,
    planStatus: row.plan_status,
    role: row.role,
  };
}

/** Thrown by requireSession; API routes turn it into a 401. */
export class Unauthorized extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'Unauthorized';
  }
}

/**
 * For API routes: throws, so the handler's catch turns it into a 401.
 */
export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new Unauthorized();
  return s;
}

/**
 * For pages: redirects to the login screen instead of throwing.
 *
 * A page that threw would be logged as an application error on every signed-out visit —
 * ordinary traffic, not a fault — and that noise would hide a real auth failure. It would
 * also leave the correct behaviour depending on the layout's redirect winning a race with
 * the page's throw, which is not something to rely on.
 */
export async function requireSessionOrRedirect(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function pruneExpiredSessions(): Promise<void> {
  await sql`DELETE FROM sessions WHERE expires_at < now() - interval '7 days'`;
}
