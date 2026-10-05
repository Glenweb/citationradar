import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { getSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Log in', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getSession()) redirect('/app');

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-7 shadow-sm">
      <h1 className="text-xl font-bold tracking-tight text-ink-900">Log in</h1>
      <p className="mt-1 text-sm text-ink-500">Welcome back.</p>
      <div className="mt-6">
        <AuthForm mode="login" />
      </div>
    </div>
  );
}
