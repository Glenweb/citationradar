'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { patch } from './client-api';

export type Branding = {
  name: string;
  brand_name: string | null;
  brand_logo_url: string | null;
  brand_colour: string;
  brand_footer: string | null;
  brand_contact: string | null;
};

export function BrandingForm({
  workspace,
  whiteLabelEnabled,
}: {
  workspace: Branding;
  whiteLabelEnabled: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: workspace.name,
    brandName: workspace.brand_name ?? '',
    brandLogoUrl: workspace.brand_logo_url ?? '',
    brandColour: workspace.brand_colour,
    brandFooter: workspace.brand_footer ?? '',
    brandContact: workspace.brand_contact ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await patch('/api/workspace', {
      name: form.name.trim() || undefined,
      brandName: form.brandName.trim() || null,
      brandLogoUrl: form.brandLogoUrl.trim() || null,
      brandColour: form.brandColour,
      brandFooter: form.brandFooter.trim() || null,
      brandContact: form.brandContact.trim() || null,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4 p-5">
      <Field
        label="Workspace name"
        value={form.name}
        onChange={(v) => set('name', v)}
        placeholder="Your agency"
      />

      <div className={whiteLabelEnabled ? '' : 'rounded-lg bg-ink-50 p-4 opacity-70'}>
        {!whiteLabelEnabled ? (
          <p className="mb-3 text-xs font-semibold text-amber-700">
            White-label is available on Growth and Agency. You can set these now — they take
            effect on exports as soon as you upgrade.
          </p>
        ) : null}

        <div className="space-y-4">
          <Field
            label="Report brand name"
            value={form.brandName}
            onChange={(v) => set('brandName', v)}
            placeholder="Shown on the report masthead instead of Citation Radar"
          />
          <div>
            <label htmlFor="brand-colour" className="block text-sm font-medium text-ink-700">
              Accent colour
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="brand-colour"
                type="color"
                value={form.brandColour}
                onChange={(e) => set('brandColour', e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-ink-300"
              />
              <input
                value={form.brandColour}
                onChange={(e) => set('brandColour', e.target.value)}
                aria-label="Accent colour hex value"
                className="w-28 rounded-lg border border-ink-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:outline-none"
              />
              <span className="text-xs text-ink-500">Used on the PDF masthead and bars.</span>
            </div>
          </div>
          <Field
            label="Logo URL"
            value={form.brandLogoUrl}
            onChange={(v) => set('brandLogoUrl', v)}
            placeholder="https://youragency.com/logo.png"
            hint="Shown on the client share page. PDF exports render your brand name as a wordmark rather than an image."
          />
          <Field
            label="Report footer"
            value={form.brandFooter}
            onChange={(v) => set('brandFooter', v)}
            placeholder="Your Agency Ltd — AI search reporting"
          />
          <Field
            label="Contact line"
            value={form.brandContact}
            onChange={(v) => set('brandContact', v)}
            placeholder="Questions? hello@youragency.com · 020 1234 5678"
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-600">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:bg-ink-400"
        >
          {busy ? 'Saving…' : 'Save branding'}
        </button>
        {saved ? <span className="text-sm font-medium text-emerald-600">Saved</span> : null}
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const id = `b-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
      />
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}
