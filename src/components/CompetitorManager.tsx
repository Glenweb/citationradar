'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { del, post } from './client-api';

export type CompetitorItem = { id: string; name: string; domain: string | null };

export function CompetitorManager({
  siteId,
  competitors,
  limit,
}: {
  siteId: string;
  competitors: CompetitorItem[];
  limit: number;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const atLimit = competitors.length >= limit;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    setBusy(true);
    const res = await post('/api/competitors', {
      siteId,
      name: name.trim(),
      domain: domain.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName('');
    setDomain('');
    router.refresh();
  }

  async function remove(id: string) {
    const res = await del(`/api/competitors/${id}`);
    if (!res.ok) setError(res.error);
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={add} className="border-b border-ink-200 p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Competitor name"
            aria-label="Competitor name"
            disabled={busy || atLimit}
            className="min-w-0 flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-ink-50"
          />
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="competitor.com (optional)"
            aria-label="Competitor domain"
            disabled={busy || atLimit}
            className="min-w-0 flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-ink-50"
          />
          <button
            type="submit"
            disabled={busy || atLimit}
            className="shrink-0 rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:bg-ink-400"
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          {competitors.length} of {limit} used. The domain lets us detect a competitor link even
          when the answer does not name them.
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-600">
            {error}
          </p>
        ) : null}
      </form>

      {competitors.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-500">
          No competitors yet. Add the brands you lose deals to.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {competitors.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-900">{c.name}</p>
                {c.domain ? <p className="truncate text-xs text-ink-500">{c.domain}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => remove(c.id)}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
