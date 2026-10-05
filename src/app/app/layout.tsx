import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { PLANS } from '@/lib/billing/plans';
import { SignOutButton } from '@/components/SignOutButton';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const plan = PLANS[session.plan];

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-center gap-5">
            <Link href="/app" className="flex shrink-0 items-center gap-2 font-bold tracking-tight text-ink-900">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-sm text-white">
                ◎
              </span>
              <span className="hidden sm:inline">Citation Radar</span>
            </Link>
            <nav className="flex items-center gap-0.5 text-sm">
              <NavLink href="/app">Dashboard</NavLink>
              <NavLink href="/app/sites">Sites</NavLink>
              <NavLink href="/app/reports">Reports</NavLink>
              <NavLink href="/app/billing">Billing</NavLink>
              <NavLink href="/app/settings">Settings</NavLink>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="truncate text-xs font-medium text-ink-800">{session.workspaceName}</p>
              <p className="text-[11px] text-ink-500">
                {plan.name} plan
                {session.planStatus === 'past_due' ? (
                  <span className="ml-1 font-semibold text-red-600">· payment failed</span>
                ) : null}
              </p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-2.5 py-1.5 font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
    >
      {children}
    </Link>
  );
}
