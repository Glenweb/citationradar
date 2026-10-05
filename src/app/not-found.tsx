import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold tracking-wide text-brand-600">404</p>
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">Page not found</h1>
      <p className="text-ink-500">That page does not exist, or it has moved.</p>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800"
      >
        Back to Citation Radar
      </Link>
    </main>
  );
}
