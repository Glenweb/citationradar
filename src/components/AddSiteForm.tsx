'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { post } from './client-api';

export function AddSiteForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [brandName, setBrandName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!url.trim() || !brandName.trim()) {
      setError('Both the URL and the brand name are needed.');
      return;
    }
    setBusy(true);
    const res = await post<{ site: { id: string } }>('/api/sites', {
      url: url.trim(),
      brandName: brandName.trim(),
    });
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    setUrl('');
    setBrandName('');
    setBusy(false);
    router.push(`/app/sites/${res.data.site.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className={compact ? 'flex flex-col gap-2 sm:flex-row' : 'grid gap-3 sm:grid-cols-2'}>
        <div className="flex-1">
          <label htmlFor="site-url" className={compact ? 'sr-only' : 'block text-sm font-medium text-ink-700'}>
            Website URL
          </label>
          <input
            id="site-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="yourwebsite.com"
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-ink-50"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="site-brand" className={compact ? 'sr-only' : 'block text-sm font-medium text-ink-700'}>
            Brand name to track
          </label>
          <input
            id="site-brand"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="Brand name as AI would say it"
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-ink-50"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className={`shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:bg-brand-400 ${compact ? 'mt-1 sm:mt-1' : 'sm:col-span-2 sm:w-fit'}`}
        >
          {busy ? 'Adding…' : 'Add site'}
        </button>
      </div>
      {!compact ? (
        <p className="text-xs text-ink-500">
          The brand name is what we look for in AI answers — use the form a person would say it,
          not your legal entity name.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  );
}
