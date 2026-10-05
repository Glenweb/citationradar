import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiAccessMatrix,
  blocksEveryone,
  isAllowed,
  parseRobots,
} from '../src/lib/crawl/robots.ts';

test('absent robots.txt allows everything', () => {
  const r = parseRobots('', null);
  assert.equal(r.permissiveByAbsence, true);
  assert.equal(isAllowed(r, 'GPTBot', '/anything'), true);
});

test('wildcard disallow blocks a bot with no group of its own', () => {
  const r = parseRobots('User-agent: *\nDisallow: /', 200);
  assert.equal(blocksEveryone(r), true);
  assert.equal(isAllowed(r, 'GPTBot', '/'), false);
});

test('a bot-specific allow overrides the wildcard disallow', () => {
  const r = parseRobots(
    'User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n',
    200,
  );
  assert.equal(isAllowed(r, 'GPTBot', '/page'), true);
  assert.equal(isAllowed(r, 'PerplexityBot', '/page'), false);
});

test('longest matching rule wins, allow breaks a tie', () => {
  const r = parseRobots(
    'User-agent: *\nDisallow: /private\nAllow: /private/public\n',
    200,
  );
  assert.equal(isAllowed(r, 'AnyBot', '/private/secret'), false);
  assert.equal(isAllowed(r, 'AnyBot', '/private/public/doc'), true);
});

test('wildcard and end-anchor patterns are honoured', () => {
  const r = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp/*/cache\n', 200);
  assert.equal(isAllowed(r, 'Bot', '/files/report.pdf'), false);
  assert.equal(isAllowed(r, 'Bot', '/files/report.pdf.html'), true);
  assert.equal(isAllowed(r, 'Bot', '/tmp/a/cache'), false);
});

test('an empty Disallow value is not a rule', () => {
  const r = parseRobots('User-agent: *\nDisallow:\n', 200);
  assert.equal(isAllowed(r, 'Bot', '/anything'), true);
  assert.equal(blocksEveryone(r), false);
});

test('consecutive user-agent lines share one group', () => {
  const r = parseRobots('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n', 200);
  assert.equal(isAllowed(r, 'GPTBot', '/'), false);
  assert.equal(isAllowed(r, 'ClaudeBot', '/'), false);
  assert.equal(isAllowed(r, 'PerplexityBot', '/'), true);
});

test('sitemaps and comments are parsed', () => {
  const r = parseRobots(
    '# a comment\nSitemap: https://e.com/sitemap.xml\nUser-agent: * # inline\nDisallow: /x\n',
    200,
  );
  assert.deepEqual(r.sitemaps, ['https://e.com/sitemap.xml']);
  assert.equal(isAllowed(r, 'Bot', '/x'), false);
});

test('access matrix flags an explicit block distinctly from a wildcard one', () => {
  const r = parseRobots(
    'User-agent: *\nDisallow:\n\nUser-agent: GPTBot\nDisallow: /\n',
    200,
  );
  const matrix = aiAccessMatrix(r);
  const gpt = matrix.find((m) => m.ua === 'GPTBot');
  const ppx = matrix.find((m) => m.ua === 'PerplexityBot');
  assert.equal(gpt.allowed, false);
  assert.equal(gpt.explicitlyBlocked, true);
  assert.equal(ppx.allowed, true);
  assert.equal(ppx.mentioned, false);
});
