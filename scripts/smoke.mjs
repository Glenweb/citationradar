#!/usr/bin/env node
/**
 * End-to-end smoke test against a running server.
 *
 *   npm run build && npm start &
 *   node scripts/smoke.mjs [baseUrl]
 *
 * Exercises every user-facing flow through the real HTTP surface: the free audit, signup,
 * a full multi-page crawl, prompt tracking, citation checks, competitor benchmarking, PDF
 * export, client share links, the n8n scheduled run, plan limits, tenancy isolation and
 * the SSRF guard. Exits non-zero on the first hard failure.
 */
const BASE = (process.argv[2] ?? process.env.SMOKE_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
const TEST_SITE = process.env.SMOKE_TEST_SITE ?? 'http://127.0.0.1:8081/';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, detail = '') {
  passed += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ''}`);
}

function bad(name, detail) {
  failed += 1;
  failures.push(`${name}: ${detail}`);
  console.log(`  \x1b[31m✗\x1b[0m ${name}\n      \x1b[31m${detail}\x1b[0m`);
}

/**
 * `detail` explains a failure, so it is only printed when the check fails — printing it
 * beside a pass made passing checks read as though they had found a problem.
 */
function check(name, condition, detail = '') {
  if (condition) ok(name);
  else bad(name, detail || 'assertion failed');
  return condition;
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/** Minimal cookie jar so the authenticated flows behave like a browser. */
function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb: (res) => {
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair?.indexOf('=') ?? -1;
        if (idx > 0) cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
    },
    clear: () => cookies.clear(),
  };
}

async function req(path, { method = 'GET', body, cookies, raw = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookies?.header() ? { Cookie: cookies.header() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  cookies?.absorb(res);
  if (raw) return { res, buffer: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, data, text, status: res.status };
}

const unique = Date.now().toString(36);
const userA = { email: `smoke-a-${unique}@example.com`, password: 'smokepassword1' };
const userB = { email: `smoke-b-${unique}@example.com`, password: 'smokepassword1' };

async function run() {
  console.log(`\x1b[1mCitation Radar smoke test\x1b[0m\n  target: ${BASE}\n  test site: ${TEST_SITE}`);

  // ── health ────────────────────────────────────────────────────────────
  section('Health and configuration');
  {
    const { data, status } = await req('/api/health');
    check('GET /api/health returns 200', status === 200, `got ${status}`);
    check('database reachable', data?.database?.ok === true, JSON.stringify(data?.database));
    check('engine status reported', Array.isArray(data?.providers?.engines) && data.providers.engines.length === 4,
      `${data?.providers?.engines?.length} engines`);
    const live = data?.providers?.engines?.filter((e) => e.configured).length ?? 0;
    ok('engine mode', `${live} live, ${4 - live} simulated`);
  }

  // ── public pages render ───────────────────────────────────────────────
  section('Public pages');
  for (const [path, needle] of [
    ['/', 'Citation Radar'],
    ['/login', 'Log in'],
    ['/signup', 'Create your free account'],
  ]) {
    const { res, text: html } = await req(path);
    check(`GET ${path} renders`, res.status === 200, `status ${res.status}`);
    check(`${path} contains expected copy`, html.includes(needle), `missing "${needle}"`);
  }
  {
    const { status } = await req('/nope-does-not-exist');
    check('unknown page returns 404', status === 404, `got ${status}`);
  }

  // ── free audit ────────────────────────────────────────────────────────
  section('Free audit (no auth)');
  let freeAuditId = null;
  {
    const { data, status } = await req('/api/public/free-audit', {
      method: 'POST',
      body: { url: TEST_SITE },
    });
    check('POST /api/public/free-audit succeeds', status === 201, `got ${status}: ${data?.error ?? ''}`);
    check('returns a score', typeof data?.score === 'number', JSON.stringify(data));
    freeAuditId = data?.publicId ?? null;

    // The test site blocks GPTBot, so the ceiling must bite.
    check('blocked GPTBot caps the score at 60', data?.score <= 60, `score was ${data?.score}`);
    ok('free audit score', `${data?.score}/100 grade ${data?.grade}`);
  }
  if (freeAuditId) {
    const { res, text: html } = await req(`/a/${freeAuditId}`);
    check('free audit result page renders', res.status === 200, `status ${res.status}`);
    check('result page names the blocked crawler', html.includes('GPTBot'), 'GPTBot not mentioned');
    check('result page shows the score cap', html.includes('capped'), 'cap not explained');
    check('result page gates the remaining fixes', html.includes('more fix'), 'no signup wall');
  }
  {
    const { data, status } = await req('/api/public/free-audit', {
      method: 'POST',
      body: { url: 'not a url at all' },
    });
    check('invalid URL is rejected', status >= 400, `got ${status}`);
    check('rejection explains itself', typeof data?.error === 'string', JSON.stringify(data));
  }

  // ── auth ──────────────────────────────────────────────────────────────
  section('Authentication and tenancy');
  const cookiesA = jar();
  const cookiesB = jar();
  {
    const { status } = await req('/api/sites');
    check('unauthenticated API call returns 401', status === 401, `got ${status}`);
  }
  {
    const { data, status } = await req('/api/auth/signup', { method: 'POST', body: userA, cookies: cookiesA });
    check('signup succeeds', status === 201, `got ${status}: ${data?.error ?? ''}`);
    check('signup sets a session cookie', !!cookiesA.header(), 'no cookie set');
    check('signup creates a workspace', !!data?.workspaceId, JSON.stringify(data));
  }
  {
    const { data, status } = await req('/api/auth/signup', { method: 'POST', body: userA });
    check('duplicate signup is rejected', status === 409, `got ${status}: ${data?.error ?? ''}`);
  }
  {
    const { data, status } = await req('/api/auth/signup', {
      method: 'POST',
      body: { email: `weak-${unique}@example.com`, password: 'short' },
    });
    check('weak password is rejected', status === 422, `got ${status}`);
    check('weak password explains why', /10 characters/.test(data?.error ?? ''), data?.error);
  }
  {
    const { data, status } = await req('/api/auth/me', { cookies: cookiesA });
    check('GET /api/auth/me reports the session', status === 200 && data?.signedIn === true, JSON.stringify(data));
    check('free plan is the default', data?.workspace?.plan === 'free', data?.workspace?.plan);
  }
  {
    const { status } = await req('/api/auth/login', {
      method: 'POST',
      body: { email: userA.email, password: 'wrongpassword1' },
    });
    check('wrong password returns 401', status === 401, `got ${status}`);
  }
  await req('/api/auth/signup', { method: 'POST', body: userB, cookies: cookiesB });

  // ── sites ─────────────────────────────────────────────────────────────
  section('Sites');
  let siteId = null;
  {
    const { data, status } = await req('/api/sites', {
      method: 'POST',
      cookies: cookiesA,
      body: { url: TEST_SITE, brandName: 'Widget Supply Co', name: 'Widget Supply' },
    });
    check('POST /api/sites creates a site', status === 201, `got ${status}: ${data?.error ?? ''}`);
    siteId = data?.site?.id ?? null;
    check('site stores a normalised domain', data?.site?.domain === '127.0.0.1', data?.site?.domain);
  }
  {
    const { data, status } = await req('/api/sites', {
      method: 'POST',
      cookies: cookiesA,
      body: { url: TEST_SITE, brandName: 'Dup' },
    });
    check('duplicate site is rejected', status === 409, `got ${status}: ${data?.error ?? ''}`);
  }
  {
    const { data, status } = await req('/api/sites', {
      method: 'POST',
      cookies: cookiesA,
      body: { url: 'http://example.org/', brandName: 'Second' },
    });
    check('free plan site limit is enforced', status === 402, `got ${status}: ${data?.error ?? ''}`);
    check('limit response names the upgrade', data?.upgradeTo === 'starter', JSON.stringify(data));
  }
  {
    const { data, status } = await req('/api/sites', {
      method: 'POST',
      cookies: cookiesA,
      body: { url: 'http://169.254.169.254/latest/meta-data/', brandName: 'SSRF' },
    });
    check('cloud metadata address is refused', status >= 400, `got ${status}`);
    ok('SSRF guard message', String(data?.error ?? '').slice(0, 70));
  }
  if (siteId) {
    const { status } = await req(`/api/sites/${siteId}`, { cookies: cookiesB });
    check('another workspace cannot read the site', status === 404, `got ${status}`);
  }

  // ── full site audit ───────────────────────────────────────────────────
  section('Full site audit');
  let auditId = null;
  if (siteId) {
    const { data, status } = await req('/api/audits', { method: 'POST', cookies: cookiesA, body: { siteId } });
    check('POST /api/audits completes a crawl', status === 201, `got ${status}: ${data?.error ?? ''}`);
    const audit = data?.audit;
    auditId = audit?.id ?? null;
    check('audit completed', audit?.status === 'complete', `status ${audit?.status}: ${audit?.error ?? ''}`);
    check('multiple pages were crawled', (audit?.pages_crawled ?? 0) >= 3, `crawled ${audit?.pages_crawled}`);
    check('score is capped by the blocked crawler', (audit?.overall_score ?? 100) <= 60, `score ${audit?.overall_score}`);
    ok('audit result', `${audit?.overall_score}/100, ${audit?.pages_crawled} pages, ${audit?.duration_ms}ms`);
  }
  if (auditId) {
    const { data, status } = await req(`/api/audits/${auditId}`, { cookies: cookiesA });
    check('GET /api/audits/[id] returns the report', status === 200, `got ${status}`);
    const issues = data?.issues ?? [];
    const pages = data?.pages ?? [];
    check('issues were derived', issues.length > 0, `${issues.length} issues`);
    check('a critical issue is ranked first', issues[0]?.severity === 'critical', `first is ${issues[0]?.severity}`);
    check('GPTBot block is reported', issues.some((i) => i.code === 'robots.gptbot_access'), 'not found');
    check('every issue carries a fix', issues.every((i) => i.how_to_fix?.length > 20), 'some lack fix copy');
    check('the JS-only page was detected', pages.some((p) => p.js_dependent), 'none flagged');
    check('the invalid JSON-LD page was detected', pages.some((p) => p.jsonld_invalid > 0), 'none flagged');
    check('the duplicate-H1 page was detected', pages.some((p) => p.h1_count === 2), 'none flagged');
    check('robots-disallowed path was skipped', !pages.some((p) => p.url.includes('/admin/')), '/admin/ was crawled');
    ok('audit detail', `${issues.length} issues across ${pages.length} pages`);

    const critical = issues.find((i) => i.severity === 'critical');
    if (critical) {
      const { data: patched, status: ps } = await req(`/api/audits/${auditId}/issues/${critical.id}`, {
        method: 'PATCH',
        cookies: cookiesA,
        body: { status: 'fixed' },
      });
      check('an issue can be marked fixed', ps === 200 && patched?.issue?.status === 'fixed', JSON.stringify(patched));
    }
  }

  // ── prompts and citations ─────────────────────────────────────────────
  section('Prompt tracking and citation checks');
  let promptId = null;
  if (siteId) {
    const { data, status } = await req('/api/prompts', {
      method: 'POST',
      cookies: cookiesA,
      body: { siteId, prompt: 'best industrial widget supplier uk', intent: 'commercial' },
    });
    check('POST /api/prompts creates a prompt', status === 201, `got ${status}: ${data?.error ?? ''}`);
    promptId = data?.prompt?.id ?? null;
    check('free plan narrows engines to one', data?.prompt?.engines?.length === 1, JSON.stringify(data?.prompt?.engines));
  }
  {
    const { data, status } = await req('/api/prompts', {
      method: 'POST',
      cookies: cookiesA,
      body: { siteId, prompt: 'out of plan engines', engines: ['chatgpt', 'perplexity', 'google_aio', 'claude'] },
    });
    check('out-of-plan engines are rejected, not silently dropped', status === 402, `got ${status}: ${data?.error ?? ''}`);
  }
  if (siteId) {
    const { data, status } = await req('/api/competitors', {
      method: 'POST',
      cookies: cookiesA,
      body: { siteId, name: 'Globex Widgets', domain: 'globex.example' },
    });
    check('POST /api/competitors creates a competitor', status === 201, `got ${status}: ${data?.error ?? ''}`);
  }
  if (promptId) {
    const { data, status } = await req(`/api/prompts/${promptId}/check`, { method: 'POST', cookies: cookiesA });
    check('POST /api/prompts/[id]/check runs', status === 200, `got ${status}: ${data?.error ?? ''}`);
    const results = data?.results ?? [];
    check('a result was recorded per engine', results.length >= 1, `${results.length} results`);
    check('results declare live or simulated', results.every((r) => r.mode === 'live' || r.mode === 'simulated'),
      JSON.stringify(results.map((r) => r.mode)));
    check('share of voice is a fraction', results.every((r) => r.shareOfVoice >= 0 && r.shareOfVoice <= 1), 'out of range');
    ok('citation check', results.map((r) => `${r.engine}:${r.brandCited ? 'cited' : 'no'}/${r.mode}`).join(' '));
  }
  if (siteId) {
    const { data, status } = await req(`/api/citations?siteId=${siteId}`, { cookies: cookiesA });
    check('GET /api/citations returns analytics', status === 200, `got ${status}`);
    check('visibility is computed', typeof data?.visibility?.checks !== 'undefined', JSON.stringify(data?.visibility));
    check('competitor benchmark includes the brand', (data?.benchmark ?? []).some((b) => b.is_brand), 'brand missing');
    check('competitor benchmark includes the competitor',
      (data?.benchmark ?? []).some((b) => b.name === 'Globex Widgets'), 'competitor missing');
  }

  // ── authed pages render ───────────────────────────────────────────────
  section('Authenticated pages');
  for (const path of ['/app', '/app/sites', '/app/reports', '/app/billing', '/app/settings',
    ...(siteId ? [`/app/sites/${siteId}`] : []), ...(auditId ? [`/app/audits/${auditId}`] : [])]) {
    const { res } = await req(path, { cookies: cookiesA });
    check(`GET ${path} renders for a signed-in user`, res.status === 200, `status ${res.status}`);
  }
  {
    const { res } = await req('/app', {});
    check('GET /app redirects when signed out', res.status === 307 || res.status === 302,
      `status ${res.status}`);
  }

  // ── plan gating on exports ────────────────────────────────────────────
  section('Reports and plan gating');
  if (auditId) {
    const { status, data } = await req(`/api/reports/audit/${auditId}`, { cookies: cookiesA });
    check('PDF export is gated on the free plan', status === 402, `got ${status}: ${data?.error ?? ''}`);
  }
  {
    const { status } = await req('/api/share', { method: 'POST', cookies: cookiesA, body: { kind: 'combined', siteId } });
    check('share links are gated on the free plan', status === 402, `got ${status}`);
  }

  // Promote to Agency to verify the paid paths, as Stripe is not configured here.
  section('Paid-plan paths (plan promoted directly, Stripe not configured)');
  const promoted = await promoteToAgency(userA.email);
  if (!promoted) {
    console.log('  \x1b[90m· skipped: could not reach the database to promote the plan\x1b[0m');
  } else {
    if (auditId) {
      const { res, buffer } = await req(`/api/reports/audit/${auditId}`, { cookies: cookiesA, raw: true });
      check('audit PDF downloads on a paid plan', res.status === 200, `status ${res.status}`);
      check('response is a PDF', buffer.subarray(0, 5).toString() === '%PDF-', buffer.subarray(0, 20).toString());
      check('PDF ends with EOF marker', buffer.subarray(-7).toString().trim().endsWith('%%EOF'), 'truncated');
      check('PDF is substantial', buffer.length > 3000, `${buffer.length} bytes`);
      check('PDF is attached with a filename',
        /filename="aeo-audit-.*\.pdf"/.test(res.headers.get('content-disposition') ?? ''),
        res.headers.get('content-disposition') ?? 'none');
      ok('audit PDF', `${(buffer.length / 1024).toFixed(1)} KB`);
    }
    if (siteId) {
      const { res, buffer } = await req(`/api/reports/citations/${siteId}`, { cookies: cookiesA, raw: true });
      check('citation PDF downloads', res.status === 200, `status ${res.status}`);
      check('citation PDF is valid', buffer.subarray(0, 5).toString() === '%PDF-', 'not a PDF');
      check('simulated data is labelled in the export',
        buffer.toString('latin1').includes('SIMULATED DATA'), 'label missing from the PDF');
      ok('citation PDF', `${(buffer.length / 1024).toFixed(1)} KB`);
    }
    {
      const { data, status } = await req('/api/share', {
        method: 'POST',
        cookies: cookiesA,
        body: { kind: 'combined', siteId, auditId, label: 'Smoke test client' },
      });
      check('share link is created on a paid plan', status === 201, `got ${status}: ${data?.error ?? ''}`);
      const token = data?.link?.token;
      if (token) {
        const { res, text: html } = await req(`/r/${token}`);
        check('public share page renders without auth', res.status === 200, `status ${res.status}`);
        check('share page is noindex', /noindex/.test(html), 'missing noindex');
        check('share page shows the report', html.includes('AI search visibility report'), 'no report content');
        const { status: revokeStatus } = await req(`/api/share/${data.link.id}`, { method: 'DELETE', cookies: cookiesA });
        check('share link can be revoked', revokeStatus === 200, `got ${revokeStatus}`);
        const { text: afterHtml } = await req(`/r/${token}`);
        check('revoked link no longer serves the report',
          afterHtml.includes('no longer active'), 'still serving');
      }
    }
    {
      const { data, status } = await req('/api/prompts', {
        method: 'POST',
        cookies: cookiesA,
        body: { siteId, prompt: 'widget supplier with same day dispatch', engines: ['chatgpt', 'perplexity', 'google_aio', 'claude'] },
      });
      check('all four engines are allowed on Agency', status === 201 && data?.prompt?.engines?.length === 4,
        `${status}: ${JSON.stringify(data?.prompt?.engines ?? data?.error)}`);
    }
  }

  // ── billing endpoints degrade cleanly ─────────────────────────────────
  section('Billing (Stripe not configured here)');
  {
    const { data, status } = await req('/api/stripe/checkout', { method: 'POST', cookies: cookiesA, body: { plan: 'growth' } });
    check('checkout reports billing is unconfigured', status === 503, `got ${status}`);
    check('the message says what to set', /STRIPE_SECRET_KEY/.test(data?.error ?? ''), data?.error);
  }
  {
    const { status } = await req('/api/stripe/webhook', { method: 'POST', body: { type: 'test' } });
    check('webhook rejects an unsigned payload', status >= 400, `got ${status}`);
  }

  // ── scheduled run (n8n) ───────────────────────────────────────────────
  section('Scheduled weekly run (n8n webhook)');
  {
    const { data, status } = await req('/api/cron/weekly');
    check('GET /api/cron/weekly reports configuration', status === 200, `got ${status}`);
    check('scheduler is configured', data?.configured === true, JSON.stringify(data));
    check('n8n webhook URL is reported', /n8n/.test(data?.n8nWebhook ?? ''), data?.n8nWebhook);
  }
  {
    const { status } = await req('/api/cron/weekly', { method: 'POST' });
    check('POST without a bearer token is refused', status === 401, `got ${status}`);
  }
  {
    const res = await fetch(`${BASE}/api/cron/weekly`, {
      method: 'POST',
      headers: { Authorization: 'Bearer definitely-not-the-secret', 'Content-Type': 'application/json' },
      body: '{}',
    });
    check('POST with a wrong token is refused', res.status === 401, `got ${res.status}`);
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.log('  \x1b[90m· skipped the authorised run: CRON_SECRET not in this shell\x1b[0m');
  } else {
    const res = await fetch(`${BASE}/api/cron/weekly`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}`, 'Content-Type': 'application/json' },
      body: '{"staleHours":0}',
    });
    const data = await res.json();
    check('authorised scheduled run executes', res.status === 200, `got ${res.status}`);
    check('run reports what it did', typeof data?.totals?.checksWritten === 'number', JSON.stringify(data?.totals));
    check('free workspaces are excluded from the schedule',
      data.workspacesEligible <= data.workspacesConsidered,
      `${data.workspacesEligible} eligible of ${data.workspacesConsidered}`);
    ok('scheduled run', `${data?.workspacesEligible} workspaces, ${data?.totals?.promptsRun} prompts, ${data?.totals?.checksWritten} checks`);
  }

  // ── logout ────────────────────────────────────────────────────────────
  section('Sign out');
  {
    const { status } = await req('/api/auth/logout', { method: 'POST', cookies: cookiesA });
    check('logout succeeds', status === 200, `got ${status}`);
    const { data } = await req('/api/auth/me', { cookies: cookiesA });
    check('session is destroyed server-side', data?.signedIn === false, JSON.stringify(data));
  }

  // ── summary ───────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1mAll ${passed} checks passed.\x1b[0m`);
  } else {
    console.log(`\x1b[31m\x1b[1m${failed} of ${passed + failed} checks failed:\x1b[0m`);
    for (const f of failures) console.log(`  · ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

/** Promote the smoke user's workspace so the paid paths can be exercised. */
async function promoteToAgency(email) {
  if (!process.env.DATABASE_URL) return false;
  try {
    const { exec, close } = await import('./_sql.mjs');
    await exec(
      `UPDATE workspaces SET plan = 'agency', plan_status = 'active'
       WHERE owner_user_id = (SELECT id FROM users WHERE email_norm = $1)`,
      [email.toLowerCase()],
    );
    await close();
    return true;
  } catch {
    return false;
  }
}

run().catch((e) => {
  console.error('\n\x1b[31mSmoke test crashed:\x1b[0m', e);
  process.exit(1);
});
