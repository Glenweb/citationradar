'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { post } from './client-api';

/**
 * Starting an audit is a synchronous crawl, so the button owns the whole wait rather
 * than polling. The copy sets the expectation, because a 100-page crawl is not instant.
 */
export function RunAuditButton({
  siteId,
  pageCap,
  variant = 'primary',
}: {
  siteId: string;
  pageCap: number;
  variant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await post<{ audit: { id: string; status: string; error?: string } }>(
      '/api/audits',
      { siteId },
    );
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    if (res.data.audit.status === 'failed') {
      setError(res.data.audit.error ?? 'The audit failed.');
      setBusy(false);
      return;
    }
    router.push(`/app/audits/${res.data.audit.id}`);
  }

  const classes =
    variant === 'primary'
      ? 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-400'
      : 'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50';

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-wait ${classes}`}
      >
        {busy ? `Crawling up to ${pageCap} pages…` : 'Run audit'}
      </button>
      {busy ? (
        <p className="mt-1 text-xs text-ink-500" aria-live="polite">
          This can take a minute or two. Leave the tab open.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 max-w-xs text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
