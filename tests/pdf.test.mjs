import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfDoc, hexToRgb, measure, truncate, wrapText } from '../src/lib/pdf/writer.ts';
import { buildAuditReport, buildCitationReport } from '../src/lib/pdf/report.ts';

const branding = {
  productName: 'Acme Digital',
  brandColour: '#0f766e',
  footer: 'Acme Digital — AEO reporting',
  contact: 'hello@acme.co.uk',
  whiteLabel: true,
};

/** Walk the xref table and confirm every offset lands on its object header. */
function assertStructurallyValid(buf) {
  const pdf = buf.toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'), 'PDF header');
  assert.ok(pdf.trimEnd().endsWith('%%EOF'), 'EOF marker');

  const m = /startxref\s+(\d+)/.exec(pdf);
  assert.ok(m, 'startxref present');
  const offset = Number(m[1]);
  assert.equal(pdf.slice(offset, offset + 4), 'xref', 'startxref points at the xref table');

  const table = pdf.slice(offset).split('trailer')[0];
  const rows = table.split('\n').filter((l) => /^\d{10} \d{5} [nf]/.test(l));
  assert.ok(rows.length > 1, 'xref has entries');

  for (let i = 1; i < rows.length; i += 1) {
    const at = Number(rows[i].slice(0, 10));
    assert.ok(
      pdf.slice(at, at + 20).startsWith(`${i} 0 obj`),
      `xref entry ${i} must point at object ${i}, found: ${JSON.stringify(pdf.slice(at, at + 20))}`,
    );
  }
  const trailer = /trailer\s*<<([\s\S]*?)>>/.exec(pdf);
  assert.ok(trailer, 'trailer dictionary');
  assert.match(trailer[1], /\/Size \d+/);
  assert.match(trailer[1], /\/Root 1 0 R/);
}

test('text measurement and wrapping are consistent', () => {
  assert.ok(measure('Hello', 10, true) > measure('Hello', 10, false), 'bold is wider');
  assert.ok(measure('iiiii', 10, false) < measure('MMMMM', 10, false), 'widths are per-glyph');
  assert.equal(measure('', 10, false), 0);

  const lines = wrapText('word '.repeat(60), 10, false, 200);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(measure(line, 10, false) <= 200, `line exceeds the box: ${line}`);
  }

  // A single unbreakable token must be split rather than overflow.
  const long = wrapText('x'.repeat(400), 10, false, 100);
  assert.ok(long.length > 1);
  for (const line of long) assert.ok(measure(line, 10, false) <= 100);

  assert.ok(truncate('a'.repeat(200), 9, false, 60).endsWith('…'));
  assert.equal(truncate('short', 9, false, 600), 'short');
});

test('hex colours parse, with a fallback for malformed input', () => {
  assert.deepEqual(hexToRgb('#ffffff'), [1, 1, 1]);
  assert.deepEqual(hexToRgb('#000000'), [0, 0, 0]);
  assert.deepEqual(hexToRgb('0f766e').map((n) => Math.round(n * 255)), [15, 118, 110]);
  assert.deepEqual(hexToRgb('not-a-colour'), [0.31, 0.275, 0.898]);
});

test('a document with content that overflows paginates', () => {
  const doc = new PdfDoc('Pagination');
  for (let i = 0; i < 140; i += 1) doc.text(`Line ${i} of filler text to force a page break.`);
  assert.ok(doc.pageCount > 1, `expected multiple pages, got ${doc.pageCount}`);
  assertStructurallyValid(doc.build());
});

test('characters outside WinAnsi are escaped, not emitted raw', () => {
  const doc = new PdfDoc('Escaping');
  doc.text('Costs £49 — "quoted" … 100% (parens) \\backslash and emoji 🎯');
  const pdf = doc.build().toString('latin1');
  assert.ok(pdf.includes('\\('), 'parentheses are escaped');
  assert.ok(pdf.includes('\\)'), 'parentheses are escaped');
  assert.ok(!/[\u{10000}-\u{10FFFF}]/u.test(pdf), 'no astral characters survive into the stream');
  assertStructurallyValid(doc.build());
});

const auditData = {
  site: { name: 'Acme Widgets', origin: 'https://acme.co.uk', brandName: 'Acme' },
  score: { overall: 58, grade: 'D', previous: 44, summary: 'Workable but with real headroom.' },
  pillars: [
    { label: 'AI crawler access', score: 40, weight: 25 },
    { label: 'Content without JavaScript', score: 90, weight: 20 },
    { label: 'Structured data', score: 55, weight: 20 },
  ],
  aiAccess: [
    { label: 'GPTBot', vendor: 'OpenAI', allowed: false },
    { label: 'PerplexityBot', vendor: 'Perplexity', allowed: true },
  ],
  issues: [
    {
      title: 'GPTBot is blocked in robots.txt',
      severity: 'critical',
      effort: 'low',
      pillarLabel: 'AI crawler access',
      whatItMeans: 'Your robots.txt tells OpenAI not to read your site.',
      whyItMatters: 'ChatGPT has no copy of your pages to cite.',
      howToFix: 'Remove the Disallow rule for GPTBot.',
      codeSnippet: 'User-agent: GPTBot\nAllow: /',
      impactPoints: 8.1,
      priorityScore: 8.1,
      affectedCount: 0,
      affectedSample: [],
    },
    {
      title: 'No question-and-answer content',
      severity: 'high',
      effort: 'medium',
      pillarLabel: 'Answerability',
      whatItMeans: 'No FAQ content was found.',
      whyItMatters: 'FAQ blocks are the most liftable format for AI answers.',
      howToFix: 'Add 5-8 real customer questions with short answers.',
      codeSnippet: null,
      impactPoints: 4.2,
      priorityScore: 2.1,
      affectedCount: 12,
      affectedSample: ['https://acme.co.uk/a', 'https://acme.co.uk/b'],
    },
  ],
  actionPlan: [
    { title: 'Unblock GPTBot', detail: 'Edit robots.txt today.', timeframe: 'This week' },
  ],
  pagesCrawled: 24,
  generatedAt: new Date('2026-10-05T12:00:00Z'),
};

test('the audit report builds a valid PDF carrying its key content', () => {
  const buf = buildAuditReport(auditData, branding);
  assertStructurallyValid(buf);
  assert.ok(buf.length > 3000, `expected a substantial document, got ${buf.length} bytes`);

  const pdf = buf.toString('latin1');
  assert.ok(pdf.includes('Acme Digital'), 'white-label product name appears');
  assert.ok(pdf.includes('GPTBot'), 'the critical finding appears');
  assert.ok(pdf.includes('CRITICAL'), 'severity is tagged');
  assert.ok(!pdf.includes('Generated by Citation Radar'), 'white-label hides our own mark');
});

test('a non-white-label export keeps the Citation Radar mark', () => {
  const pdf = buildAuditReport(auditData, {
    productName: 'Citation Radar',
    brandColour: '#4f46e5',
    footer: null,
    contact: null,
    whiteLabel: false,
  }).toString('latin1');
  assert.ok(pdf.includes('Generated by Citation Radar'));
});

test('an audit with no issues still produces a valid report', () => {
  const buf = buildAuditReport(
    { ...auditData, issues: [], actionPlan: [], score: { ...auditData.score, overall: 97, grade: 'A', previous: null } },
    branding,
  );
  assertStructurallyValid(buf);
  assert.ok(buf.toString('latin1').includes('No issues found'));
});

test('the citation report builds a valid PDF and labels simulated data', () => {
  const buf = buildCitationReport(
    {
      site: { name: 'Acme Widgets', origin: 'https://acme.co.uk', brandName: 'Acme' },
      visibility: { checks: 12, cited: 7, visibility: 58.3, avgSov: 34.2 },
      anySimulated: true,
      byEngine: [
        { engine: 'chatgpt', checks: 4, cited: 3, visibility: 75 },
        { engine: 'perplexity', checks: 4, cited: 3, visibility: 75 },
        { engine: 'google_aio', checks: 4, cited: 1, visibility: 25 },
      ],
      prompts: [
        {
          prompt: 'best widget supplier uk',
          results: [
            { engine: 'chatgpt', cited: true, position: 1, sov: 0.5, mode: 'simulated' },
            { engine: 'google_aio', cited: false, position: null, sov: 0, mode: 'simulated' },
          ],
        },
      ],
      benchmark: [
        { name: 'Acme', isBrand: true, mentions: 9, presence: 58.3 },
        { name: 'Globex', isBrand: false, mentions: 14, presence: 75 },
      ],
      history: [
        { day: '2026-09-01', visibility: 40 },
        { day: '2026-09-08', visibility: 55 },
        { day: '2026-09-15', visibility: 58 },
      ],
      generatedAt: new Date('2026-10-05T12:00:00Z'),
    },
    branding,
  );
  assertStructurallyValid(buf);
  const pdf = buf.toString('latin1');
  assert.ok(pdf.includes('SIMULATED DATA'), 'simulated data must be labelled in exports');
  assert.ok(pdf.includes('Globex'), 'competitors appear in the benchmark');
});

test('an empty citation report does not crash the writer', () => {
  const buf = buildCitationReport(
    {
      site: { name: 'Acme', origin: 'https://acme.co.uk', brandName: 'Acme' },
      visibility: { checks: 0, cited: 0, visibility: 0, avgSov: 0 },
      anySimulated: false,
      byEngine: [],
      prompts: [],
      benchmark: [],
      history: [],
      generatedAt: new Date('2026-10-05T12:00:00Z'),
    },
    branding,
  );
  assertStructurallyValid(buf);
});
