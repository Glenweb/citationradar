# API reference

All endpoints return JSON. Authenticated endpoints read the session from the `cr_session`
cookie; the workspace is taken from the session and never from the request, so a request
cannot reach another workspace's data by changing an id.

Errors are `{ "error": "message" }` with a meaningful status:

| Status | Meaning |
|---|---|
| 401 | Not signed in |
| 402 | Plan limit reached — the body carries `limit`, `used` and `upgradeTo` |
| 403 | Signed in, but not permitted (owner-only actions) |
| 404 | Not found, or not in your workspace |
| 409 | Conflict (duplicate, or wrong state for the action) |
| 422 | Validation failed, or a URL that cannot be audited |
| 429 | Rate limited (free audit) |
| 503 | A required integration is not configured — the message names the variable |

## Public

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | Database and provider status. Reports which engines are live vs simulated. |
| `POST` | `/api/public/free-audit` | `{ url }` → `{ publicId, score, grade, remaining }`. 5 per IP per 24h. |

## Auth

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/auth/signup` | `{ email, password, name?, workspaceName? }` — creates the user, workspace and session |
| `POST` | `/api/auth/login` | `{ email, password }` |
| `POST` | `/api/auth/logout` | — revokes the session server-side |
| `GET` | `/api/auth/me` | Session, workspace and plan limits |

## Sites

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/sites` | With latest score, prompt and competitor counts |
| `POST` | `/api/sites` | `{ url, brandName, name?, brandAliases? }` |
| `GET` | `/api/sites/[siteId]` | Site with its audits, prompts and competitors |
| `PATCH` | `/api/sites/[siteId]` | `{ name?, brandName?, brandAliases? }` |
| `DELETE` | `/api/sites/[siteId]` | Cascades to audits, prompts and checks |

## Audits

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/audits` | Last 50 for the workspace |
| `POST` | `/api/audits` | `{ siteId, maxPages? }` — runs the crawl and returns the finished audit. Capped by plan. |
| `GET` | `/api/audits/[auditId]` | Audit, issues and crawled pages |
| `PATCH` | `/api/audits/[auditId]/issues/[issueId]` | `{ status: open \| in_progress \| fixed \| ignored }` |

A full crawl is synchronous and can take a minute or more; `maxDuration` is 300s.

## Prompts and citations

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/prompts?siteId=` | |
| `POST` | `/api/prompts` | `{ siteId, prompt, intent?, locale?, engines? }`. Engines outside your plan are **rejected**, not silently dropped. |
| `GET` | `/api/prompts/[promptId]` | Prompt with its check history |
| `PATCH` | `/api/prompts/[promptId]` | `{ prompt?, intent?, engines?, isActive? }` |
| `DELETE` | `/api/prompts/[promptId]` | |
| `POST` | `/api/prompts/[promptId]/check` | Runs the prompt against its engines now |
| `GET` | `/api/citations?siteId=&days=90` | Visibility, latest checks, history and competitor benchmark |

## Competitors

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/competitors?siteId=` | |
| `POST` | `/api/competitors` | `{ siteId, name, domain?, aliases? }` |
| `DELETE` | `/api/competitors/[competitorId]` | |

## Workspace and reports

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/workspace` | Workspace, plan limits, usage and integration status |
| `PATCH` | `/api/workspace` | Branding. Owner only. |
| `GET` | `/api/reports/audit/[auditId]` | PDF. Starter and above. |
| `GET` | `/api/reports/citations/[siteId]` | PDF. Starter and above. |
| `GET` | `/api/share` | Client links |
| `POST` | `/api/share` | `{ kind, siteId?, auditId?, label? }`. Growth and above. |
| `DELETE` | `/api/share/[linkId]` | Revokes the link; the row and its view count survive |

## Billing

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/stripe/checkout` | `{ plan }` → `{ url }`. Owner only. |
| `POST` | `/api/stripe/portal` | → `{ url }`. Owner only. |
| `POST` | `/api/stripe/webhook` | Signature-verified. Event ids recorded for idempotency. |

## Scheduled runs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/cron/weekly` | Configuration check; runs nothing |
| `POST` | `/api/cron/weekly` | `Authorization: Bearer $CRON_SECRET`. See [N8N.md](N8N.md). |
