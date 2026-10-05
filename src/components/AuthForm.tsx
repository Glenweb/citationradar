'use client';

import Link from 'next/link';
import { useState } from 'react';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSignup = mode === 'signup';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(e.currentTarget);
    const payload = isSignup
      ? {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
          name: String(form.get('name') ?? '') || undefined,
          workspaceName: String(form.get('workspaceName') ?? '') || undefined,
        }
      : {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        };

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Try again.');
        setBusy(false);
        return;
      }
      // A full navigation rather than a client push, so the new session cookie is
      // picked up by the server components that read it.
      window.location.href = '/app';
    } catch {
      setError('Could not reach the server. Check your connection.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {isSignup ? (
        <Field label="Your name" name="name" type="text" autoComplete="name" placeholder="Optional" />
      ) : null}

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@company.com"
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={isSignup ? 'new-password' : 'current-password'}
        required
        placeholder={isSignup ? 'At least 10 characters' : ''}
        hint={isSignup ? 'At least 10 characters, with a letter and a number.' : undefined}
      />
      {isSignup ? (
        <Field
          label="Workspace name"
          name="workspaceName"
          type="text"
          placeholder="Optional — your agency or company"
        />
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:bg-brand-400"
      >
        {busy ? 'Just a moment…' : isSignup ? 'Create free account' : 'Log in'}
      </button>

      <p className="text-center text-sm text-ink-500">
        {isSignup ? 'Already have an account? ' : 'No account yet? '}
        <Link
          href={isSignup ? '/login' : '/signup'}
          className="font-semibold text-brand-600 hover:text-brand-700"
        >
          {isSignup ? 'Log in' : 'Start free'}
        </Link>
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  required,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const id = `field-${name}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
