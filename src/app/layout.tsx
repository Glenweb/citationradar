import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Citation Radar — AI search visibility audits and citation tracking',
    template: '%s · Citation Radar',
  },
  description:
    'Audit your site for AI search readiness and track whether ChatGPT, Perplexity and Google AI Overviews cite your brand. Free single-URL audit, no signup.',
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
  openGraph: {
    title: 'Citation Radar — AI search visibility',
    description:
      'Find out whether AI assistants can read your site, and whether they cite you.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f46e5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      {/*
        Browser extensions commonly add attributes to <body> before React hydrates —
        Grammarly's `data-gr-ext-installed` is the usual culprit — and React reports the
        resulting mismatch as a hydration error the app can do nothing about.

        suppressHydrationWarning applies only to this element's own attributes and text,
        one level deep. Mismatches inside `children` are still reported, so a genuine
        hydration bug in the app is not hidden by this.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
