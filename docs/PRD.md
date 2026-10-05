# Citation Radar — Product Requirements

> AEO site audit + AI citation tracking in one tool.
> Benchmark to beat: **AEO Engine (aeoengine.ai)** — on price, report clarity, and citation-tracking depth.

## 1. Problem

Search is splitting in two. Classic SERP traffic still exists, but a growing share of
commercial questions are answered inside ChatGPT, Perplexity and Google AI Overviews —
where there is no blue link to rank for. Site owners now need two things they cannot get
from a classic SEO tool:

1. **Is my site even readable by AI crawlers?** Most sites fail on invisible mechanics:
   `GPTBot` blocked in `robots.txt`, content rendered only by client-side JavaScript,
   broken JSON-LD, no `llms.txt`.
2. **Am I actually being cited?** Rankings are no longer the KPI. The KPI is whether the
   assistant names your brand and links your domain when a buyer asks a question.

Existing AEO tools answer one or the other, charge enterprise prices, and output reports
that a non-technical client cannot act on.

## 2. Target users

| Segment | Core job | What makes them pay |
|---|---|---|
| **Website / business owner** | "Am I invisible to ChatGPT?" | A free audit that finds a scary, specific, fixable problem |
| **SEO agency** | Prove AEO value to retainer clients | White-label PDF reports + multi-site workspaces |
| **Local business** | Get named for "best X near me" | Citation tracking on a handful of money prompts |

## 3. Positioning vs AEO Engine

| Dimension | AEO Engine | Citation Radar |
|---|---|---|
| Entry price | Paid-only, ~$99+/mo tier entry | **Free single-URL audit, no signup; paid from £29/mo** |
| Audit + tracking | Largely audit-led | **Both in one workspace, same score surface** |
| Engines tracked | Narrow | **ChatGPT, Perplexity, Google AI Overviews, Claude (4)** |
| Report clarity | Technical issue dump | **Prioritised fix list — impact ÷ effort, plain-English fix, copy-paste snippet** |
| Competitor view | Limited | **Share-of-voice benchmark per prompt per engine** |
| White-label | Higher tiers | **From £79/mo, with client-facing share links** |
| Scheduling | In-app | **In-app + n8n webhook, so agencies wire it into their own ops** |

Three deliberate wedges:
1. **Free, no-signup, single-URL audit** as the acquisition engine.
2. **Priority score** (`impact ÷ effort`) so the report ends in a to-do list, not a lecture.
3. **Share of voice**, not just "cited yes/no" — the number an agency can put in a retainer report.

## 4. Core features

### 4.1 Free audit (no auth)
Paste one URL → crawl that page + `robots.txt` + `llms.txt` → AEO score, pillar breakdown,
top 3 fixes revealed, remainder gated behind signup. Rate-limited by IP.

### 4.2 Full site audit (auth)
robots.txt-aware, same-origin crawl with a plan-based page cap. Scores six pillars,
emits issues with severity/impact/effort, generates Claude-written fix recommendations.

### 4.3 AEO score model
Six weighted pillars, 0–100 overall:

| Pillar | Weight | Why it matters |
|---|---|---|
| **AI crawler access** | 25 | If `GPTBot` is blocked, nothing else can help you |
| **Content without JavaScript** | 20 | AI crawlers largely do not execute JS |
| **Structured data** | 20 | JSON-LD is how engines resolve entities |
| **Answerability** | 15 | One H1, clean hierarchy, FAQ blocks, direct answers |
| **Answer surface** | 10 | `llms.txt`, `llms-full.txt`, sitemap |
| **Entity clarity** | 10 | Consistent brand name, `sameAs`, author, About/Contact |

### 4.4 Prompt tracking + citation checks
Track prompts per site across 4 engines. Each check records: cited (bool), brand position,
citation URLs, competitor mentions, response excerpt, share of voice. History charted over time.

### 4.5 Competitor benchmark
Per site, up to N competitors. Share-of-voice table by prompt × engine, plus a trend line.

### 4.6 White-label reports
Workspace branding (logo, name, colour, footer). Export audit + citation reports as PDF.
Shareable public client link with a revocable token.

### 4.7 Billing
Stripe subscriptions, four tiers, plan limits enforced server-side at the point of action.

### 4.8 Scheduled runs
`POST /api/cron/weekly` with a bearer secret, called by the n8n webhook at
`gmkmedia.app.n8n.cloud`. Re-runs active prompts for every paid workspace.

## 5. Plans

| | **Free** | **Starter £29** | **Growth £79** | **Agency £199** |
|---|---|---|---|---|
| Sites | 1 | 1 | 5 | 25 |
| Pages per audit | 10 | 100 | 500 | 2,000 |
| Audits / month | 3 | 30 | 150 | unlimited |
| Tracked prompts | 3 | 25 | 150 | 750 |
| Engines | 1 | 3 | 4 | 4 |
| Competitors / site | 1 | 3 | 10 | 25 |
| Weekly auto-checks | — | ✓ | ✓ | ✓ |
| PDF export | — | ✓ | ✓ | ✓ |
| White-label | — | — | ✓ | ✓ |
| Client share links | — | — | ✓ | ✓ |
| API + n8n webhook | — | — | ✓ | ✓ |

## 6. Non-goals (v1)
Backlink analysis, keyword volume research, rank tracking for classic SERPs, content
generation at scale, team seat management beyond owner/member.

## 7. Success metrics
- Free audit → signup conversion ≥ 8%
- Median time-to-first-value < 60s (free audit result)
- Paid conversion ≥ 4% of signups within 14 days
- An agency can produce a client-ready PDF in under 3 clicks
