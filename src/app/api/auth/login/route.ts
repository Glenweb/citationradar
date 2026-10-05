import { sql, sqlOne } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { loginSchema } from '@/lib/validate';
import { fail, handleError, ok, readJson } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const body = loginSchema.parse(await readJson(req));
    const emailNorm = body.email.trim().toLowerCase();

    const user = await sqlOne<{ id: string; password_hash: string }>`
      SELECT id, password_hash FROM users WHERE email_norm = ${emailNorm}
    `;

    // Same message and comparable work for both failure modes, so the response does not
    // reveal whether an account exists.
    const valid = user ? await verifyPassword(body.password, user.password_hash) : false;
    if (!user || !valid) return fail('Email or password is incorrect.', 401);

    await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
    await createSession(user.id, req.headers.get('user-agent') ?? undefined);

    return ok({ userId: user.id });
  } catch (e) {
    return handleError(e);
  }
}
