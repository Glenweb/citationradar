import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { getSession } from '@/lib/auth/session';
import { PLANS } from '@/lib/billing/plans';

export const metadata: Metadata = { title: 'Create your account', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  if (await getSession()) redirect('/app');
  const free = PLANS.free;

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-7 shadow-sm">
      <h1 className="text-xl font-bold tracking-tight text-ink-900">Create your free account</h1>
      <p className="mt-1 text-sm text-ink-500">
        {free.sites} site, {free.auditsPerMonth} audits a month and {free.prompts} tracked prompts.
        No card needed.
      </p>
      <div className="mt-6">
        <AuthForm mode="signup" />
      </div>
    </div>
  );
}
