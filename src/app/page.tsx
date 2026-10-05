import Link from 'next/link';
import { FreeAuditForm } from '@/components/FreeAuditForm';
import { ALL_ENGINES, ENGINE_LABELS, PLANS, PLAN_ORDER, formatLimit } from '@/lib/billing/plans';
import { PILLARS } from '@/lib/aeo/score';
import { Badge } from '@/components/ui';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-ink-900">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-sm text-white">
              ◎
            </span>
            Citation Radar
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <Link href="#how" className="hidden rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-50 sm:block">
              How it works
            </Link>
            <Link href="#pricing" className="hidden rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-50 sm:block">
              Pricing
            </Link>
            <Link href="/login" className="rounded-lg px-3 py-2 font-medium text-ink-700 hover:bg-ink-50">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-ink-900 px-4 py-2 font-semibold text-white transition hover:bg-ink-800"
            >
              Start free
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ink-200">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[48rem] -translate-x-1/2 rounded-full bg-brand-100 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl px-6 py-20 text-center sm:py-28">
          <Badge tone="info" className="mb-5">
            Free single-URL audit · no signup
          </Badge>
          <h1 className="text-balance text-4xl font-extrabold tracking-tight text-ink-900 sm:text-5xl">
            Can ChatGPT actually read your website?
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-ink-600">
            Most sites fail AI search on things nobody checks: a blocked <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.9em]">GPTBot</code>,
            content that only renders in JavaScript, broken JSON-LD. Citation Radar finds
            those in seconds — then tracks whether the assistants actually cite you.
          </p>

          <div className="mx-auto mt-9 max-w-xl">
            <FreeAuditForm />
          </div>

          <ul className="mx-auto mt-10 flex max-w-xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-ink-500">
            {ALL_ENGINES.map((e) => (
              <li key={e} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                {ENGINE_LABELS[e]}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* The problem */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-ink-900">
            Rankings stopped being the whole story
          </h2>
          <p className="mt-4 text-ink-600">
            When a buyer asks an assistant instead of a search engine, there is no blue link to
            rank for. Either the assistant names you, or it names a competitor. Two things decide
            which — and classic SEO tools measure neither.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <article className="rounded-2xl border border-ink-200 bg-ink-50/60 p-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Problem one</p>
            <h3 className="mt-2 text-xl font-bold text-ink-900">The crawlers can&apos;t read you</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-600">
              AI crawlers largely don&apos;t execute JavaScript, and many sites block them outright
              in <code className="rounded bg-white px-1 font-mono text-[0.9em]">robots.txt</code> —
              often left over from a staging deploy nobody revisited. We fetch your pages exactly as
              an AI crawler does and tell you what it got.
            </p>
          </article>
          <article className="rounded-2xl border border-ink-200 bg-ink-50/60 p-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Problem two</p>
            <h3 className="mt-2 text-xl font-bold text-ink-900">You don&apos;t know if you&apos;re cited</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-600">
              You can&apos;t open four assistants every week and type the same twenty questions.
              We do it for you, record who got named, in what order, and what share of the
              conversation was yours against each competitor.
            </p>
          </article>
        </div>
      </section>

      {/* Scoring model */}
      <section id="how" className="border-y border-ink-200 bg-ink-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-ink-900">
              One score, six things that decide it
            </h2>
            <p className="mt-4 text-ink-600">
              Every check is weighted by how much it actually affects whether an engine can use
              your content — not by how easy it was to measure.
            </p>
          </div>

          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((pillar) => (
              <li key={pillar.id} className="rounded-xl border border-ink-200 bg-white p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-ink-900">{pillar.label}</h3>
                  <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                    {pillar.weight}%
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{pillar.blurb}</p>
              </li>
            ))}
          </ol>

          <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">A blocked crawler caps your score.</p>
            <p className="mt-1 opacity-90">
              If ChatGPT&apos;s crawler can&apos;t reach you, no amount of schema work matters —
              so the score is capped at 60 until access is restored, and the report says exactly why.
              A headline number that hides a hard block is worse than no number at all.
            </p>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-3">
          {[
            {
              title: 'A fix list, not an issue dump',
              body: 'Every finding is ranked by score impact divided by effort, and written so you can hand it to a client or a developer: what it means, why it costs you, and the exact snippet to paste.',
            },
            {
              title: 'Share of voice, not just yes/no',
              body: '"Cited" hides the fact that a competitor was named six times and you once. We track mentions, the order brands appear in, and your share of every tracked prompt.',
            },
            {
              title: 'White-label client reporting',
              body: 'Your logo, your colour, your footer. Export a PDF or send a client a read-only link that you can revoke. Scheduled weekly, or driven from your own n8n workflow.',
            },
          ].map((f) => (
            <article key={f.title}>
              <h3 className="text-lg font-bold text-ink-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-ink-200 bg-ink-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-ink-900">Simple pricing</h2>
            <p className="mt-4 text-ink-600">
              Start with the free audit. Upgrade when you want it tracked every week.
            </p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-4">
            {PLAN_ORDER.map((id) => {
              const plan = PLANS[id];
              const featured = id === 'growth';
              return (
                <div
                  key={id}
                  className={`relative flex flex-col rounded-2xl border bg-white p-6 ${
                    featured ? 'border-brand-400 shadow-lg ring-1 ring-brand-200' : 'border-ink-200'
                  }`}
                >
                  {featured ? (
                    <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
                      Most popular
                    </span>
                  ) : null}
                  <h3 className="font-bold text-ink-900">{plan.name}</h3>
                  <p className="mt-1 min-h-[2.5rem] text-xs text-ink-500">{plan.tagline}</p>
                  <p className="mt-3">
                    <span className="text-3xl font-extrabold tracking-tight text-ink-900">
                      £{plan.priceGbp}
                    </span>
                    <span className="text-sm text-ink-500">/mo</span>
                  </p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm text-ink-600">
                    <li>{formatLimit(plan.sites)} site{plan.sites === 1 ? '' : 's'}</li>
                    <li>{formatLimit(plan.pagesPerAudit)} pages per audit</li>
                    <li>{formatLimit(plan.prompts)} tracked prompts</li>
                    <li>{plan.engines} AI engine{plan.engines === 1 ? '' : 's'}</li>
                    <li>{formatLimit(plan.competitorsPerSite)} competitors per site</li>
                    <li className={plan.weeklyAutoChecks ? '' : 'text-ink-300 line-through'}>
                      Weekly auto-checks
                    </li>
                    <li className={plan.pdfExport ? '' : 'text-ink-300 line-through'}>PDF export</li>
                    <li className={plan.whiteLabel ? '' : 'text-ink-300 line-through'}>
                      White-label reports
                    </li>
                    <li className={plan.apiAccess ? '' : 'text-ink-300 line-through'}>
                      API + n8n webhook
                    </li>
                  </ul>
                  <Link
                    href="/signup"
                    className={`mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition ${
                      featured
                        ? 'bg-brand-600 text-white hover:bg-brand-700'
                        : 'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50'
                    }`}
                  >
                    {id === 'free' ? 'Start free' : `Choose ${plan.name}`}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-ink-900">
          Find out where you stand
        </h2>
        <p className="mt-3 text-ink-600">
          One URL, about fifteen seconds, no account needed.
        </p>
        <div className="mt-7">
          <FreeAuditForm />
        </div>
      </section>

      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Citation Radar</p>
          <nav className="flex gap-5">
            <Link href="#pricing" className="hover:text-ink-800">Pricing</Link>
            <Link href="/login" className="hover:text-ink-800">Log in</Link>
            <Link href="/signup" className="hover:text-ink-800">Start free</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
