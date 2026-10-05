import { randomBytes } from 'node:crypto';
import { sqlOne } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { planOf } from '@/lib/billing/plans';
import { listShareLinks } from '@/lib/reports';
import { shareLinkSchema } from '@/lib/validate';
import { env } from '@/lib/env';
import { fail, handleError, ok, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireSession();
    const links = await listShareLinks(session.workspaceId);
    return ok({
      links: links.map((l) => ({ ...l, url: `${env.appUrl}/r/${l.token}` })),
    });
  } catch (e) {
    return handleError(e);
  }
}

/** Mint a read-only client link. 32 bytes of entropy, revocable, no workspace data. */
export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = shareLinkSchema.parse(await readJson(req));

    if (!planOf(session.plan).shareLinks) {
      return fail('Client share links are available on the Growth plan and above.', 402, {
        upgradeTo: 'growth',
      });
    }

    if (body.kind === 'audit' && !body.auditId) return fail('auditId is required.', 400);
    if (body.kind !== 'audit' && !body.siteId) return fail('siteId is required.', 400);

    if (body.auditId) {
      const owned = await sqlOne`
        SELECT id FROM audits WHERE id = ${body.auditId} AND workspace_id = ${session.workspaceId}
      `;
      if (!owned) return fail('Audit not found.', 404);
    }
    if (body.siteId) {
      const owned = await sqlOne`
        SELECT id FROM sites WHERE id = ${body.siteId} AND workspace_id = ${session.workspaceId}
      `;
      if (!owned) return fail('Site not found.', 404);
    }

    const token = randomBytes(24).toString('base64url');
    const link = await sqlOne<{ id: string; token: string }>`
      INSERT INTO share_links (workspace_id, site_id, audit_id, kind, token, label)
      VALUES (${session.workspaceId}, ${body.siteId ?? null}, ${body.auditId ?? null},
              ${body.kind}, ${token}, ${body.label ?? null})
      RETURNING id, token
    `;
    return ok({ link: { ...link, url: `${env.appUrl}/r/${token}` } }, 201);
  } catch (e) {
    return handleError(e);
  }
}
