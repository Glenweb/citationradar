'use client';

import { useState } from 'react';
import { post } from './client-api';

export function UpgradeButton({
  plan,
  label,
  available,
  featured,
}: {
  plan: 'starter' | 'growth' | 'agency';
  label: string;
  available: boolean;
  featured?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upgrade() {
    setBusy(true);
    setError(null);
    const res = await post<{ url: string }>('/api/stripe/checkout', { plan });
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    window.location.href = res.data.url;
  }

  if (!available) {
    return (
      <div className="mt-6">
        <button
          type="button"
          disabled
          title="Billing is not configured on this deployment"
          className="w-full cursor-not-allowed rounded-lg bg-ink-100 px-4 py-2.5 text-sm font-semibold text-ink-400"
        >
          Not available
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={upgrade}
        disabled={busy}
        className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${
          featured
            ? 'bg-brand-600 text-white hover:bg-brand-700'
            : 'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50'
        }`}
      >
        {busy ? 'Opening checkout…' : label}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ManageBillingButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    const res = await post<{ url: string }>('/api/stripe/portal');
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    window.location.href = res.data.url;
  }

  return (
    <div>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-800 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-60"
      >
        {busy ? 'Opening…' : 'Manage billing'}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
