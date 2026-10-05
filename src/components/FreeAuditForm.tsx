'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * The acquisition surface: paste a URL, get a score. No signup.
 * Kept as a client component because it is the one piece of the landing page that
 * genuinely needs interactivity.
 */
export function FreeAuditForm({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!url.trim()) {
      setError('Enter a URL to audit.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/public/free-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json()) as { publicId?: string; error?: string };

      if (!res.ok || !data.publicId) {
        setError(data.error ?? 'That URL could not be audited. Check it and try again.');
        setSubmitting(false);
        return;
      }
      startTransition(() => router.push(`/a/${data.publicId}`));
    } catch {
      setError('Could not reach the audit service. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  const busy = submitting || pending;
  const big = size === 'lg';

  return (
    <form onSubmit={onSubmit} className="w-full">
      <div
        className={`flex flex-col gap-2 sm:flex-row ${big ? '' : 'sm:gap-1.5'}`}
      >
        <label htmlFor="free-audit-url" className="sr-only">
          Website URL
        </label>
        <input
          id="free-audit-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="yourwebsite.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby={error ? 'free-audit-error' : undefined}
          className={`min-w-0 flex-1 rounded-lg border border-ink-300 bg-white text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-ink-50 ${
            big ? 'px-4 py-3 text-base' : 'px-3 py-2 text-sm'
          }`}
        />
        <button
          type="submit"
          disabled={busy}
          className={`shrink-0 rounded-lg bg-brand-600 font-semibold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:bg-brand-400 ${
            big ? 'px-6 py-3 text-base' : 'px-4 py-2 text-sm'
          }`}
        >
          {busy ? 'Auditing…' : 'Audit my site free'}
        </button>
      </div>

      {error ? (
        <p id="free-audit-error" role="alert" className="mt-2 text-sm font-medium text-red-600">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-xs text-ink-500">
          No signup. Takes about 15 seconds. We check your robots.txt, llms.txt, schema and
          whether your content survives without JavaScript.
        </p>
      )}

      {busy ? (
        <p className="mt-2 text-xs text-ink-500" aria-live="polite">
          Fetching your page as an AI crawler would see it…
        </p>
      ) : null}
    </form>
  );
}
