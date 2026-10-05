import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-3.5">
          <Link href="/" className="inline-flex items-center gap-2 font-bold tracking-tight text-ink-900">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-sm text-white">
              ◎
            </span>
            Citation Radar
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 items-center px-6 py-12">
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}
