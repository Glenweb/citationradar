import { sql, sqlOne } from '@/lib/db';
import { hashPassword, passwordProblem } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { signupSchema } from '@/lib/validate';
import { fail, handleError, ok, readJson } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const body = signupSchema.parse(await readJson(req));
    const problem = passwordProblem(body.password);
    if (problem) return fail(problem, 422);

    const emailNorm = body.email.trim().toLowerCase();
    const existing = await sqlOne<{ id: string }>`
      SELECT id FROM users WHERE email_norm = ${emailNorm}
    `;
    if (existing) return fail('An account with that email already exists.', 409);

    const user = await sqlOne<{ id: string; email: string }>`
      INSERT INTO users (email, email_norm, name, password_hash)
      VALUES (${body.email.trim()}, ${emailNorm}, ${body.name ?? null},
              ${await hashPassword(body.password)})
      RETURNING id, email
    `;
    if (!user) return fail('Could not create the account.', 500);

    // Every user gets a workspace; it is the tenancy boundary, so nothing exists outside one.
    const name = body.workspaceName?.trim() || defaultWorkspaceName(body.email);
    const workspace = await sqlOne<{ id: string; slug: string }>`
      INSERT INTO workspaces (name, slug, owner_user_id)
      VALUES (${name}, ${await uniqueSlug(name)}, ${user.id})
      RETURNING id, slug
    `;
    if (!workspace) return fail('Could not create the workspace.', 500);

    await sql`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${workspace.id}, ${user.id}, 'owner')
    `;
    await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
    await createSession(user.id, req.headers.get('user-agent') ?? undefined);

    return ok({ userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug }, 201);
  } catch (e) {
    return handleError(e);
  }
}

function defaultWorkspaceName(email: string): string {
  const local = email.split('@')[0] ?? 'My';
  return `${local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}'s workspace`;
}

async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';

  for (let i = 0; i < 40; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await sqlOne`SELECT 1 FROM workspaces WHERE slug = ${candidate}`;
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
