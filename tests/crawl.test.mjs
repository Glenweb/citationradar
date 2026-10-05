import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysePage, normaliseLink } from '../src/lib/crawl/analyse.ts';

function res(body, overrides = {}) {
  return {
    ok: true,
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    statusCode: 200,
    contentType: 'text/html',
    body,
    bytes: body.length,
    latencyMs: 10,
    truncated: false,
    ...overrides,
  };
}

test('a server-rendered page is read correctly', () => {
  const a = analysePage(
    res(`<!doctype html><html><head>
      <title>Widgets for business — Acme</title>
      <meta name="description" content="We sell widgets.">
      <link rel="canonical" href="https://example.com/">
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Organization","name":"Acme",
         "sameAs":["https://linkedin.com/company/acme"]}
      </script>
    </head><body>
      <h1>Widgets for business</h1>
      <p>Acme supplies industrial widgets to UK manufacturers, shipping the same working day on orders placed before 2pm.</p>
      <h2>How much do widgets cost?</h2>
      <p>From GBP 4.95 each.</p>
      <ul><li>One</li><li>Two</li></ul>
      <table><tr><td>x</td></tr></table>
      <a href="/about">About</a><a href="/contact?utm_source=x">Contact</a>
      <a href="https://other.com/x">External</a><a href="/logo.png">Image</a>
    </body></html>`),
    0,
  );

  assert.equal(a.title, 'Widgets for business — Acme');
  assert.equal(a.h1, 'Widgets for business');
  assert.equal(a.h1Count, 1);
  assert.equal(a.jsonldBlocks, 1);
  assert.equal(a.jsonldInvalid, 0);
  assert.ok(a.jsonldTypes.includes('Organization'));
  assert.deepEqual(a.sameAs, ['https://linkedin.com/company/acme']);
  assert.equal(a.jsDependent, false);
  assert.equal(a.hasDirectAnswer, true, 'the opener is a 15-80 word answer');
  assert.equal(a.questionHeadings, 1);
  assert.equal(a.listCount, 1);
  assert.equal(a.tableCount, 1);
  assert.equal(a.headingSkips, 0);
  assert.equal(a.canonical, 'https://example.com/');
  // External links, assets and tracking params are excluded or normalised away.
  assert.deepEqual(a.internalLinks.sort(), [
    'https://example.com/about',
    'https://example.com/contact',
  ]);
});

test('an empty SPA shell is flagged as JavaScript-dependent', () => {
  const a = analysePage(
    res(`<!doctype html><html><head><title>App</title></head><body>
      <div id="__next"></div>
      <script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script>
    </body></html>`),
    0,
  );
  assert.equal(a.jsDependent, true);
  assert.ok(a.jsDependentReason.length > 10, 'the reason must be explainable in the report');
  assert.ok(a.wordCount < 30);
});

test('a noscript plea for JavaScript is flagged', () => {
  const a = analysePage(
    res(`<html><body><div>${'word '.repeat(200)}</div>
      <noscript>Please enable JavaScript to use this site.</noscript></body></html>`),
    0,
  );
  assert.equal(a.jsDependent, true);
});

test('invalid and valid JSON-LD on one page are counted separately', () => {
  const a = analysePage(
    res(`<html><head>
      <script type="application/ld+json">{"@type":"Article","headline":"x"}</script>
      <script type="application/ld+json">{"@type":"Article",}</script>
      <script type="application/ld+json">{"name":"no type"}</script>
    </head><body><p>${'word '.repeat(200)}</p></body></html>`),
    0,
  );
  assert.equal(a.jsonldBlocks, 3);
  assert.equal(a.jsonldInvalid, 2, 'a parse failure and a missing @type both count');
  assert.deepEqual(a.jsonldTypes, ['Article']);
});

test('heading skips are detected', () => {
  const a = analysePage(
    res('<html><body><h1>A</h1><h2>B</h2><h4>C</h4><h2>D</h2><h5>E</h5></body></html>'),
    0,
  );
  assert.equal(a.headingSkips, 2, 'h2->h4 and h2->h5');
});

test('FAQPage schema and details elements both register as FAQ content', () => {
  const schema = analysePage(
    res('<html><head><script type="application/ld+json">{"@type":"FAQPage"}</script></head><body><p>x</p></body></html>'),
    0,
  );
  assert.equal(schema.hasFaqSchema, true);
  assert.equal(schema.hasFaq, true);

  const details = analysePage(
    res('<html><body><details><summary>Q1</summary>A</details><details><summary>Q2</summary>A</details></body></html>'),
    0,
  );
  assert.equal(details.hasFaqSchema, false);
  assert.equal(details.hasFaq, true);
});

test('a fetch error is carried through rather than scored as a page', () => {
  const a = analysePage(res('', { error: 'Timed out after 12s', statusCode: null, ok: false }), 0);
  assert.equal(a.error, 'Timed out after 12s');
  assert.equal(a.wordCount, 0);
});

test('non-HTML responses are rejected', () => {
  const a = analysePage(res('{"a":1}', { contentType: 'application/json' }), 0);
  assert.match(a.error, /Not HTML/);
});

test('link normalisation strips fragments, tracking and trailing slashes', () => {
  const base = new URL('https://example.com/dir/page');
  assert.equal(normaliseLink('/a/', base), 'https://example.com/a');
  assert.equal(normaliseLink('/a#section', base), 'https://example.com/a');
  assert.equal(normaliseLink('/a?utm_source=x&id=2', base), 'https://example.com/a?id=2');
  assert.equal(normaliseLink('relative', base), 'https://example.com/dir/relative');
  assert.equal(normaliseLink('mailto:a@b.com', base), null);
  assert.equal(normaliseLink('javascript:void(0)', base), null);
  assert.equal(normaliseLink('https://other.com/a', base), null);
  assert.equal(normaliseLink('/style.css', base), null);
  assert.equal(normaliseLink('/doc.pdf', base), null);
});

test('proxy bypass honours NO_PROXY and always skips private destinations', async () => {
  const { bypassesProxy } = await import('../src/lib/crawl/fetcher.ts');
  const u = (s) => new URL(s);

  // Always bypass, listed or not: a proxy cannot reach these, and routing them to one
  // makes the crawler read the proxy's refusal as the site's own response.
  assert.equal(bypassesProxy(u('http://127.0.0.1:8081/'), ''), true);
  assert.equal(bypassesProxy(u('http://localhost:3000/'), ''), true);
  assert.equal(bypassesProxy(u('http://10.1.2.3/'), ''), true);
  assert.equal(bypassesProxy(u('http://192.168.1.5/'), ''), true);
  assert.equal(bypassesProxy(u('http://169.254.169.254/'), ''), true);

  // Public hosts go through the proxy unless NO_PROXY says otherwise.
  assert.equal(bypassesProxy(u('https://example.com/'), ''), false);
  assert.equal(bypassesProxy(u('https://example.com/'), 'example.com'), true);
  assert.equal(bypassesProxy(u('https://api.example.com/'), 'example.com'), true);
  assert.equal(bypassesProxy(u('https://api.example.com/'), '.example.com'), true);
  assert.equal(bypassesProxy(u('https://notexample.com/'), 'example.com'), false);
  assert.equal(bypassesProxy(u('https://example.com/'), 'other.com, example.com'), true);
  assert.equal(bypassesProxy(u('https://anything.com/'), '*'), true);

  // CIDR entries apply to literal IPs only.
  assert.equal(bypassesProxy(u('http://100.70.0.1/'), '100.64.0.0/10'), true);
  assert.equal(bypassesProxy(u('http://8.8.8.8/'), '100.64.0.0/10'), false);
});
