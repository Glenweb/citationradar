import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseResponse, countMentions, domainMatches, domainOf } from '../src/lib/citations/analyse.ts';
import { simulateCheck } from '../src/lib/citations/simulate.ts';

const query = {
  prompt: 'best crm for small business uk',
  brandName: 'Acme CRM',
  brandAliases: ['Acme'],
  domain: 'acme.co.uk',
  competitors: [
    { name: 'Zoho', domain: 'zoho.com', aliases: [] },
    { name: 'Pipedrive', domain: 'pipedrive.com', aliases: [] },
  ],
  locale: 'en-GB',
};

test('mentions match on word boundaries, not substrings', () => {
  assert.equal(countMentions('Acme is great', ['Acme']).count, 1);
  assert.equal(countMentions('Acmetech is unrelated', ['Acme']).count, 0);
  assert.equal(countMentions('acme CRM and Acme CRM', ['Acme CRM']).count, 2);
  // A two-word brand tolerates a hyphen or extra whitespace.
  assert.equal(countMentions('Acme-CRM rocks', ['Acme CRM']).count, 1);
});

test('domain matching accepts subdomains but not lookalikes', () => {
  assert.equal(domainMatches('www.acme.co.uk', 'acme.co.uk'), true);
  assert.equal(domainMatches('blog.acme.co.uk', 'acme.co.uk'), true);
  assert.equal(domainMatches('notacme.co.uk', 'acme.co.uk'), false);
  assert.equal(domainOf('https://www.Acme.co.uk/page?x=1'), 'acme.co.uk');
});

test('a cited brand gets position 1 when named first', () => {
  const r = analyseResponse(
    'perplexity',
    query,
    'Acme CRM is the strongest option. Zoho is cheaper. Pipedrive is also worth a look.',
    [{ url: 'https://acme.co.uk/' }, { url: 'https://zoho.com/' }],
    'live',
    120,
  );
  assert.equal(r.brandCited, true);
  assert.equal(r.brandPosition, 1);
  assert.equal(r.domainLinked, true);
  assert.equal(r.brandMentions, 1);
  assert.equal(r.sentiment, 'positive');
});

test('position reflects the order brands are named', () => {
  const r = analyseResponse(
    'chatgpt',
    query,
    'Zoho leads the market. Pipedrive is popular too. Acme CRM is a smaller alternative.',
    [],
    'live',
    120,
  );
  assert.equal(r.brandPosition, 3);
  const zoho = r.competitorMentions.find((c) => c.name === 'Zoho');
  assert.equal(zoho.position, 1);
});

test('share of voice is the brand share of all tracked mentions', () => {
  const r = analyseResponse(
    'chatgpt',
    query,
    'Acme CRM and Acme are both names for it. Zoho. Zoho. Pipedrive.',
    [],
    'live',
    1,
  );
  // 'Acme CRM' matches once and the alias 'Acme' matches twice (both occurrences),
  // against 2 Zoho + 1 Pipedrive.
  assert.ok(r.brandMentions >= 2, `got ${r.brandMentions}`);
  assert.ok(r.shareOfVoice > 0 && r.shareOfVoice < 1);
  const total = r.brandMentions + r.competitorMentions.reduce((s, c) => s + c.mentions, 0);
  assert.equal(r.shareOfVoice, Number((r.brandMentions / total).toFixed(4)));
});

test('a linked domain counts as a citation even without a name in the prose', () => {
  const r = analyseResponse(
    'google_aio',
    query,
    'Several providers compete in this space.',
    [{ url: 'https://acme.co.uk/pricing', title: 'Pricing' }],
    'live',
    1,
  );
  assert.equal(r.brandMentions, 0);
  assert.equal(r.brandCited, true, 'a referral link is still a citation');
  assert.equal(r.domainLinked, true);
});

test('an uncited brand scores zero and keeps competitor data', () => {
  const r = analyseResponse(
    'chatgpt',
    query,
    'Zoho and Pipedrive are the usual recommendations.',
    [{ url: 'https://zoho.com/' }],
    'live',
    1,
  );
  assert.equal(r.brandCited, false);
  assert.equal(r.brandPosition, null);
  assert.equal(r.shareOfVoice, 0);
  assert.equal(r.competitorMentions.filter((c) => c.mentions > 0).length, 2);
  assert.equal(r.sentiment, null);
});

test('citation urls are deduped and flagged as brand or not', () => {
  const r = analyseResponse(
    'perplexity',
    query,
    'Acme CRM.',
    [
      { url: 'https://acme.co.uk/page' },
      { url: 'https://acme.co.uk/page?utm=x' },
      { url: 'https://zoho.com/' },
    ],
    'live',
    1,
  );
  assert.equal(r.citationUrls.length, 2, 'the tracked-param duplicate collapses');
  assert.equal(r.citationUrls.filter((u) => u.isBrand).length, 1);
});

test('simulated checks are deterministic for the same query', () => {
  const a = simulateCheck('chatgpt', query);
  const b = simulateCheck('chatgpt', query);
  assert.deepEqual(a, b, 'the same input must always give the same simulated result');
  assert.equal(a.mode, 'simulated', 'simulated results must be labelled');
});

test('simulated checks differ across engines and across prompts', () => {
  const chatgpt = simulateCheck('chatgpt', query);
  const perplexity = simulateCheck('perplexity', query);
  const other = simulateCheck('chatgpt', { ...query, prompt: 'cheapest crm uk' });
  assert.notEqual(chatgpt.responseExcerpt, perplexity.responseExcerpt);
  assert.notEqual(chatgpt.responseExcerpt, other.responseExcerpt);
});

test('every engine simulates a structurally valid result', () => {
  for (const engine of ['chatgpt', 'perplexity', 'google_aio', 'claude']) {
    const r = simulateCheck(engine, query);
    assert.equal(r.engine, engine);
    assert.equal(r.mode, 'simulated');
    assert.ok(r.shareOfVoice >= 0 && r.shareOfVoice <= 1);
    assert.ok(r.latencyMs > 0);
    assert.ok(Array.isArray(r.citationUrls));
    assert.equal(typeof r.brandCited, 'boolean');
    if (r.brandCited) assert.ok(r.brandPosition >= 1);
  }
});

test('an alias overlapping the full brand name is not double-counted', () => {
  // "Acme CRM" must count once, not once for the full name and again for the alias.
  assert.equal(countMentions('Acme CRM is good.', ['Acme CRM', 'Acme']).count, 1);
  // A standalone alias elsewhere is a second, genuine mention.
  assert.equal(countMentions('Acme CRM is good. Acme ships fast.', ['Acme CRM', 'Acme']).count, 2);
  // The longest form wins the span regardless of the order names are supplied.
  assert.equal(countMentions('Acme CRM is good.', ['Acme', 'Acme CRM']).count, 1);
});

test('sentiment reads inflected praise and criticism', () => {
  const positive = analyseResponse('chatgpt', query, 'Acme CRM is the strongest option.', [], 'live', 1);
  assert.equal(positive.sentiment, 'positive');

  const negative = analyseResponse(
    'chatgpt',
    query,
    'Acme CRM is overpriced and users report complaints about support.',
    [],
    'live',
    1,
  );
  assert.equal(negative.sentiment, 'negative');

  const neutral = analyseResponse('chatgpt', query, 'Acme CRM is a CRM product.', [], 'live', 1);
  assert.equal(neutral.sentiment, 'neutral');
});
