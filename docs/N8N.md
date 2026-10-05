# Scheduled weekly runs via n8n

Citation Radar does not run its own scheduler. It exposes one authenticated endpoint and
lets you drive it from n8n, so an agency can wire citation checks into the same workflow
as its reporting and client comms.

## The endpoint

```
POST /api/cron/weekly
Authorization: Bearer $CRON_SECRET
Content-Type: application/json

{ "workspaceId": "optional-uuid", "staleHours": 144 }
```

| Field | Default | Meaning |
|---|---|---|
| `workspaceId` | all | Run one workspace instead of every eligible one |
| `staleHours` | `144` | Skip prompts checked more recently than this (~6 days, so a weekly schedule never skips itself by an hour) |

Only workspaces on a plan with weekly auto-checks are processed; free workspaces are
counted and skipped. Each run is recorded in `scheduled_runs`, so a missed week is visible
rather than silent.

A `GET` on the same path reports whether the scheduler is configured, without running
anything — useful as an n8n health check.

```bash
curl https://your-app.vercel.app/api/cron/weekly
# { "endpoint": "POST /api/cron/weekly", "configured": true, "n8nWebhook": "…" }
```

## Response

```json
{
  "ran": true,
  "workspacesConsidered": 12,
  "workspacesEligible": 9,
  "totals": { "promptsRun": 143, "checksWritten": 418 },
  "results": [
    { "workspaceId": "…", "plan": "growth", "promptsRun": 24, "checksWritten": 72 }
  ]
}
```

## Setting it up in n8n

Workflow at `gmkmedia.app.n8n.cloud`:

1. **Schedule Trigger** — Weekly, Monday, 07:00.
2. **HTTP Request**
   - Method: `POST`
   - URL: `https://your-app.vercel.app/api/cron/weekly`
   - Authentication: *Generic Credential Type → Header Auth*
     - Name: `Authorization`
     - Value: `Bearer YOUR_CRON_SECRET`
   - Body: JSON, `{}` for every workspace
   - **Timeout: 300000** (5 minutes) — a large run makes many engine calls
3. **IF** node on `{{ $json.totals.checksWritten > 0 }}` to branch on whether anything ran.
4. **Slack / Email** node to post the summary.

### Importable skeleton

```json
{
  "name": "Citation Radar — weekly checks",
  "nodes": [
    {
      "parameters": { "rule": { "interval": [{ "field": "weeks", "triggerAtDay": [1], "triggerAtHour": 7 }] } },
      "name": "Monday 07:00",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [240, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://your-app.vercel.app/api/cron/weekly",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={}",
        "options": { "timeout": 300000 }
      },
      "name": "Run citation checks",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [480, 300]
    }
  ],
  "connections": {
    "Monday 07:00": { "main": [[{ "node": "Run citation checks", "type": "main", "index": 0 }]] }
  }
}
```

Add the `Authorization` header as a Header Auth credential rather than putting the secret
in the node body.

## Timeouts and large accounts

A run makes one API call per (prompt × engine). On a serverless platform the function has a
hard ceiling — `maxDuration` is set to 300s. For an account large enough to exceed that,
fan out in n8n instead of sending one request:

1. Fetch your workspace IDs (from your own records, or the database).
2. **Split In Batches** over them.
3. Call the endpoint once per workspace with `{"workspaceId": "…"}`.

Each call then only has that workspace's prompts to get through.

## Alternatives

Nothing about the endpoint is n8n-specific. The same call works from Vercel Cron, GitHub
Actions, or any scheduler that can send a bearer token:

```yaml
# .github/workflows/weekly-citations.yml
on:
  schedule:
    - cron: '0 7 * * 1'
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "$APP_URL/api/cron/weekly" \
            -H "Authorization: Bearer $CRON_SECRET" \
            -H 'Content-Type: application/json' -d '{}'
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```
