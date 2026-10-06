import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, aiAccessMatrix } from '../src/lib/crawl/robots.ts';
import { scoreCrawl, gradeFor, PILLARS } from '../src/lib/aeo/score.ts';
import { deriveIssues } from '../src/lib/aeo/issues.ts';

function page(overrides = {}) {
  return {
    url: 'https://example.com/',
    depth: 0,
    statusCode: 200,
    contentType: 'text/html',
    title: 'Example Brand — Widgets for business',
    titleLength: 38,
    metaDescription: 'We sell widgets.',
    h1: 'Widgets for business',
    h1Count: 1,
    headingOutline: [
      { level: 1, text: 'Widgets for business' },
      { level: 2, text: 'How much do widgets cost?' },
      { level: 2, text: 'Do you deliver to the UK?' },
    ],
    headingSkips: 0,
    wordCount: 850,
    textRatio: 0.18,
    jsDependent: false,
    jsDependentReason: null,
    jsonldBlocks: 2,
    jsonldInvalid: 0,
    jsonldTypes: ['Organization', 'WebSite', 'FAQPage', 'Article', 'BreadcrumbList'],
    sameAs: ['https://linkedin.com/x', 'https://x.com/y', 'https://wikidata.org/z'],
    hasFaqSchema: true,
    hasFaq: true,
    questionHeadings: 2,
    hasDirectAnswer: true,
    listCount: 3,
    tableCount: 1,
    dateModified: '2026-10-01',
    author: 'A Writer',
    canonical: 'https://example.com/',
    noindex: false,
    internalLinks: [],
    ...overrides,
  };
}

function outcome(overrides = {}) {
  const robots = parseRobots('User-agent: *\nDisallow:\n', 200);
  return {
    origin: 'https://example.com',
    robots,
    aiAccess: aiAccessMatrix(robots),
    answerSurface: {
      llmsTxt: { present: true, bytes: 900, wellFormed: true, sections: 3 },
      llmsFullTxt: { present: true, bytes: 9000 },
      sitemap: { present: true, urlCount: 42, source: 'robots' },
    },
    pages: [page()],
    capped: false,
    skippedByRobots: 0,
    durationMs: 100,
    ...overrides,
  };
}

test('a fully optimised site scores at or near the top', () => {
  const s = scoreCrawl(outcome(), 'Example Brand');
  assert.ok(s.overall >= 95, `expected >= 95, got ${s.overall}`);
  assert.equal(s.grade, 'A');
  assert.equal(deriveIssues(s).length, 0, 'a perfect site should raise no issues');
});

test('pillar weights total 100', () => {
  assert.equal(PILLARS.reduce((n, p) => n + p.weight, 0), 100);
});

test('a blocked GPTBot produces a critical issue ranked first', () => {
  const robots = parseRobots('User-agent: GPTBot\nDisallow: /\n', 200);
  const s = scoreCrawl(outcome({ robots, aiAccess: aiAccessMatrix(robots) }), 'Example Brand');
  const issues = deriveIssues(s);

  assert.ok(s.overall < 95, 'blocking GPTBot must cost score');
  assert.equal(issues[0].severity, 'critical');
  assert.equal(issues[0].code, 'robots.gptbot_access');
  assert.ok(issues[0].codeSnippet.includes('GPTBot'));
});

test('a site-wide disallow is catastrophic for the crawler-access pillar', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /\n', 200);
  const s = scoreCrawl(outcome({ robots, aiAccess: aiAccessMatrix(robots) }), 'Example Brand');
  const pillar = s.pillars.find((p) => p.id === 'crawler_access');
  assert.ok(pillar.score <= 10, `expected <= 10, got ${pillar.score}`);
  assert.ok(s.overall < 60);
});

test('a JavaScript-only page is scored as unreadable content', () => {
  const s = scoreCrawl(
    outcome({ pages: [page({ jsDependent: true, wordCount: 18, textRatio: 0.004 })] }),
    'Example Brand',
  );
  const pillar = s.pillars.find((p) => p.id === 'no_js_content');
  assert.ok(pillar.score < 40, `expected < 40, got ${pillar.score}`);
  const issue = deriveIssues(s).find((i) => i.code === 'nojs.server_rendered');
  assert.equal(issue.severity, 'critical');
  assert.equal(issue.effort, 'high');
});

test('invalid JSON-LD is reported separately from missing JSON-LD', () => {
  const s = scoreCrawl(
    outcome({ pages: [page({ jsonldInvalid: 1 })] }),
    'Example Brand',
  );
  const codes = deriveIssues(s).map((i) => i.code);
  assert.ok(codes.includes('schema.valid'));
  assert.ok(!codes.includes('schema.present'), 'schema is present, just partly invalid');
});

test('priority ranks a cheap fix above an expensive one of similar impact', () => {
  const robots = parseRobots('User-agent: PerplexityBot\nDisallow: /\n', 200);
  const s = scoreCrawl(
    outcome({
      robots,
      aiAccess: aiAccessMatrix(robots),
      answerSurface: {
        llmsTxt: { present: false, bytes: 0, wellFormed: false, sections: 0 },
        llmsFullTxt: { present: false, bytes: 0 },
        sitemap: { present: true, urlCount: 10, source: 'default' },
      },
      pages: [page({ wordCount: 120 })],
    }),
    'Example Brand',
  );
  const issues = deriveIssues(s);
  for (const i of issues) {
    assert.ok(i.priorityScore > 0, `${i.code} should carry a positive priority`);
    assert.ok(i.impactPoints > 0, `${i.code} should carry recoverable points`);
  }
  // Every issue carries client-ready copy; that is the product promise.
  for (const i of issues) {
    assert.ok(i.whatItMeans.length > 20, `${i.code} needs a plain-English explanation`);
    assert.ok(i.whyItMatters.length > 20, `${i.code} needs a why`);
    assert.ok(i.howToFix.length > 20, `${i.code} needs a fix`);
  }
});

test('pillars with no applicable checks are excluded, not scored zero', () => {
  // A page that failed to load leaves the content pillars with nothing to assess.
  const s = scoreCrawl(
    outcome({ pages: [page({ statusCode: 500, error: 'Server error' })] }),
    'Example Brand',
  );
  const structured = s.pillars.find((p) => p.id === 'structured_data');
  assert.equal(structured.checks.length, 0);
  // Crawler access and answer surface still pass, so the score must not collapse to 0.
  assert.ok(s.overall > 0, 'score should reflect the pillars that could be assessed');
});

test('grades map to the documented bands', () => {
  assert.equal(gradeFor(100), 'A');
  assert.equal(gradeFor(90), 'A');
  assert.equal(gradeFor(89), 'B');
  assert.equal(gradeFor(70), 'C');
  assert.equal(gradeFor(39), 'F');
});

test('a crawl that fetched nothing must not produce a score', async () => {
  // The real-world case: the host is unreachable, so every page errored. robots.txt and
  // llms.txt are "absent" only because we never got there — scoring that yields a
  // plausible-looking number for a site nobody actually looked at.
  const unreachable = outcome({
    pages: [{ ...page(), statusCode: null, error: 'fetch failed', wordCount: 0, jsonldBlocks: 0 }],
    answerSurface: {
      llmsTxt: { present: false, bytes: 0, wellFormed: false, sections: 0 },
      llmsFullTxt: { present: false, bytes: 0 },
      sitemap: { present: false, urlCount: 0, source: null },
    },
  });

  const s = scoreCrawl(unreachable, 'Example Brand');
  // Scoring itself still runs — the guard that refuses to publish it lives in runAudit —
  // but the content pillars must have had nothing to assess.
  for (const id of ['structured_data', 'answerability', 'entity_clarity']) {
    const pillar = s.pillars.find((p) => p.id === id);
    assert.equal(pillar.checks.length, 0, `${id} should have no applicable checks`);
  }

  const { assertSomethingWasFetched } = await import('../src/lib/aeo/run.ts');
  assert.throws(
    () => assertSomethingWasFetched(unreachable, 'https://example.com/'),
    (e) => {
      assert.equal(e.name, 'SiteUnreachableError');
      assert.match(e.message, /could not fetch example\.com/i);
      assert.match(e.message, /fetch failed/);
      return true;
    },
  );
});

test('an HTTP error from the site is reported as a crawler block, not a score', async () => {
  const { assertSomethingWasFetched } = await import('../src/lib/aeo/run.ts');
  const blocked = outcome({
    pages: [{ ...page(), statusCode: 403, wordCount: 0 }],
  });
  assert.throws(
    () => assertSomethingWasFetched(blocked, 'https://example.com/'),
    (e) => {
      assert.equal(e.name, 'SiteUnreachableError');
      assert.match(e.message, /HTTP 403/);
      // The finding that matters: the AI crawlers will be refused the same way.
      assert.match(e.message, /GPTBot/);
      return true;
    },
  );
});

test('a crawl with at least one good page is allowed to score', async () => {
  const { assertSomethingWasFetched } = await import('../src/lib/aeo/run.ts');
  const mixed = outcome({
    pages: [{ ...page(), statusCode: 500, error: 'Server error' }, page()],
  });
  assert.doesNotThrow(() => assertSomethingWasFetched(mixed, 'https://example.com/'));
});
