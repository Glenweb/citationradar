# Citation Radar — Architecture

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15.5 (App Router) on Vercel | Server routes + RSC in one deploy unit |
| Language | TypeScript (strict) | — |
| Database | Neon Postgres via `@neondatabase/serverless` | HTTP driver, no pool to leak in serverless |
| Migrations | Plain SQL files + `scripts/migrate.mjs` | No ORM runtime, auditable DDL, zero lock-in |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`) | — |
| Auth | First-party HMAC-signed session cookie, scrypt password hashing (`node:crypto`) | No auth vendor, no extra dependency |
| AI recommendations | Anthropic Claude (`@anthropic-ai/sdk`) | Fix-list prose + prompt suggestions |
| Citation engines | OpenAI, Perplexity, DataForSEO (Google AI Overview), Anthropic | 4 engines behind one interface |
| Billing | Stripe Checkout + webhooks | — |
| Charts | Hand-rolled inline SVG | No chart dependency; renders in RSC and inside PDFs |
| PDF | Hand-rolled writer (`src/lib/pdf/`) | Zero-dep, runs in serverless, no headless browser |
| Scheduling | n8n webhook → `POST /api/cron/weekly` | Agencies already run n8n |

## Degraded mode (important)

Every external provider is behind an interface with `isConfigured()`. With no API key, the
provider returns a **deterministic simulated result**, seeded by a hash of
`(prompt, engine, brand, competitors)` so the same input always gives the same output.

Simulated results are persisted with `mode = 'simulated'` and the UI labels them
**"Simulated"** on every surface — chart, table, PDF and share link. The app therefore runs
and demos end-to-end with zero third-party keys, and no simulated number can ever be
mistaken for a real citation. Crawling and AEO scoring are **always real** — they need no
API key, only outbound HTTP.

## Request flow — full site audit

```
POST /api/audits  { siteId, maxPages? }
  │
  ├─ requireSession()            → session cookie → user + workspace
  ├─ assertPlanLimit('audit')    → usage table vs PLANS[plan]
  ├─ INSERT audits (status=queued)
  └─ runAudit(auditId)           → awaited; status=running → complete|failed
        │
        ├─ fetchRobots(origin)              robots.txt → AI-bot access matrix
        ├─ fetchAnswerSurface(origin)       llms.txt, llms-full.txt, sitemap.xml
        ├─ crawl(origin, cap)               same-origin BFS, robots-respecting,
        │                                   concurrency 4, per-page analyse()
        ├─ score(pages, robots, surface)    6 pillars → overall 0-100
        ├─ deriveIssues(...)                checks → issues + priority score
        ├─ recommend(issues)                Claude prose, falls back to static copy
        └─ INSERT audit_pages, audit_issues; UPDATE audits
```

## Request flow — citation check

```
POST /api/prompts/[id]/check   (or cron/weekly for every active prompt)
  │
  ├─ load prompt, site, brand, competitors
  ├─ for each engine in prompt.engines:
  │     provider.check({ prompt, brand, competitors })
  │       ├─ configured   → real API call, parse citations from response
  │       └─ unconfigured → deterministic simulation, mode='simulated'
  │     → { cited, position, citationUrls, competitorMentions, excerpt, shareOfVoice }
  └─ INSERT citation_checks (one row per engine per run)
```

## Folder structure

```
citationradar/
├── docs/                         PRD, architecture, API reference, n8n setup
├── db/migrations/                0001_init.sql … (applied in filename order)
├── scripts/
│   ├── migrate.mjs               runner + ledger table, --reset
│   ├── seed.mjs                  demo workspace, site, prompts, competitors, history
│   └── smoke.mjs                 hits every route against a running server
├── tests/                        node:test — scoring, robots, priority, pdf, sim
└── src/
    ├── app/
    │   ├── (marketing)/          landing, pricing, free-audit result
    │   ├── (auth)/               login, signup
    │   ├── app/                  authed product shell
    │   │   ├── page.tsx                      dashboard
    │   │   ├── sites/[siteId]/               overview
    │   │   ├── sites/[siteId]/prompts/       tracker + history chart
    │   │   ├── sites/[siteId]/competitors/   share-of-voice benchmark
    │   │   ├── sites/[siteId]/report/        white-label export
    │   │   ├── audits/[auditId]/             score + prioritised fix list
    │   │   ├── billing/  settings/
    │   ├── r/[token]/            public client-facing share link
    │   └── api/                  see docs/API.md
    ├── components/               server + client UI primitives, SVG charts
    └── lib/
        ├── db.ts  schema.ts  env.ts
        ├── auth/                 password, session, guards
        ├── crawl/                robots.ts, fetcher.ts, crawler.ts, analyse.ts
        ├── aeo/                  score.ts, checks.ts, issues.ts, recommend.ts
        ├── citations/            index.ts, openai.ts, perplexity.ts,
        │                         dataforseo.ts, anthropic.ts, simulate.ts
        ├── billing/              plans.ts, stripe.ts, usage.ts
        └── pdf/                  writer.ts, report.ts
```

## Data model

See `db/migrations/0001_init.sql` for authoritative DDL.

```
users ──┬─< workspace_members >─┬── workspaces ──< sites ──┬──< audits ──┬──< audit_pages
        │                       │       │                  │             └──< audit_issues
        │                       │       ├──< usage_counters │
        │                       │       └──< scheduled_runs ├──< tracked_prompts ──< citation_checks
        └───────────────────────┘                           ├──< competitors
                                                            └──< share_links
```

Key decisions:
- **`workspaces` is the tenancy boundary.** Every row below it carries `workspace_id`
  so authorisation is a single predicate, never a join chain.
- **`audits` is immutable once complete.** Re-auditing creates a new row, so score history
  is free and reports are reproducible.
- **`citation_checks` is append-only** — one row per (prompt, engine, run). The chart is a
  `GROUP BY date_trunc('day')`, no mutation.
- **`pillar_scores` and `evidence` are `jsonb`** — the check catalogue evolves faster than
  a migration cadence should.
- **`mode` column on `citation_checks`** (`live` | `simulated`) is non-null, so the
  provenance of every number survives into exports.

## Security

- Passwords: `scrypt` (N=16384, r=8, p=1), 16-byte salt, constant-time compare.
- Sessions: opaque 32-byte token, SHA-256 hashed at rest in `sessions`, delivered as
  `HttpOnly; SameSite=Lax; Secure` cookie. Revocable server-side.
- Tenancy: every query filters by `workspace_id` taken from the session, never from the
  request body.
- SSRF: the crawler resolves and rejects private/loopback/link-local address ranges,
  non-HTTP(S) schemes, and refuses to leave the origin it was given.
- Crawl politeness: `robots.txt` honoured for our own UA, 1 req/300ms per host,
  hard page cap, 10s timeout, 2 MB response ceiling.
- Stripe webhooks: signature-verified; unverified payloads are rejected before parsing.
- Cron endpoint: constant-time bearer comparison against `CRON_SECRET`.
- Share links: 32-byte token, revocable, read-only projection, no workspace data leakage.
