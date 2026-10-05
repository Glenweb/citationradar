'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { del, post } from './client-api';

export type ShareLinkItem = {
  id: string;
  token: string;
  kind: string;
  label: string | null;
  site_id: string | null;
  audit_id: string | null;
  view_count: number;
  revoked_at: string | null;
  created_at: string;
};

export function ShareLinkManager({
  links,
  sites,
  enabled,
  appUrl,
}: {
  links: ShareLinkItem[];
  sites: { id: string; name: string; latest_audit_id: string | null }[];
  enabled: boolean;
  appUrl: string;
}) {
  const router = useRouter();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [kind, setKind] = useState<'audit' | 'citations' | 'combined'>('combined');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const site = sites.find((s) => s.id === siteId);
    if (!site) {
      setError('Pick a site first.');
      return;
    }
    if (kind === 'audit' && !site.latest_audit_id) {
      setError('That site has no completed audit yet, so there is nothing to share.');
      return;
    }

    setBusy(true);
    const res = await post('/api/share', {
      kind,
      siteId: site.id,
      auditId: kind === 'citations' ? undefined : (site.latest_audit_id ?? undefined),
      label: label.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLabel('');
    router.refresh();
  }

  async function revoke(id: string) {
    const res = await del(`/api/share/${id}`);
    if (!res.ok) setError(res.error);
    router.refresh();
  }

  async function copy(token: string) {
    const url = `${appUrl}/r/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy. The link is shown below — copy it manually.');
    }
  }

  return (
    <div>
      {enabled ? (
        <form onSubmit={create} className="border-b border-ink-200 p-5">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              aria-label="Site"
              disabled={busy || !sites.length}
              className="rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none disabled:bg-ink-50"
            >
              {sites.length === 0 ? <option value="">No sites yet</option> : null}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              aria-label="Report type"
              disabled={busy}
              className="rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="combined">Audit + citations</option>
              <option value="audit">Audit only</option>
              <option value="citations">Citations only</option>
            </select>
            <button
              type="submit"
              disabled={busy || !sites.length}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:bg-brand-400"
            >
              {busy ? 'Creating…' : 'Create link'}
            </button>
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label, e.g. Acme Ltd — October review (optional)"
            aria-label="Link label"
            disabled={busy}
            className="mt-2 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <p className="mt-2 text-xs text-ink-500">
            Anyone with the link can read the report. No login, no workspace access, and you can
            revoke it at any time.
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-sm font-medium text-red-600">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}

      {links.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-500">No client links yet.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {links.map((link) => {
            const url = `${appUrl}/r/${link.token}`;
            const revoked = !!link.revoked_at;
            return (
              <li key={link.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${revoked ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                      {link.label ?? `${link.kind} report`}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-[11px] text-ink-500">{url}</p>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      {link.view_count} view{link.view_count === 1 ? '' : 's'} ·{' '}
                      {new Date(link.created_at).toLocaleDateString('en-GB')}
                      {revoked ? ' · revoked' : ''}
                    </p>
                  </div>
                  {!revoked ? (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => copy(link.token)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-50"
                      >
                        {copied === link.token ? 'Copied' : 'Copy'}
                      </button>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-ink-100"
                      >
                        Open
                      </a>
                      <button
                        type="button"
                        onClick={() => revoke(link.id)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      >
                        Revoke
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
