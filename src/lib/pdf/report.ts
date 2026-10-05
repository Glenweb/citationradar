import { PdfDoc, hexToRgb, measure, tint, type Rgb } from './writer';
import { ENGINE_LABELS, type EngineId } from '../billing/plans';

export type Branding = {
  productName: string;
  brandColour: string;
  footer: string | null;
  contact: string | null;
  whiteLabel: boolean;
};

export type AuditReportData = {
  site: { name: string; origin: string; brandName: string };
  score: { overall: number; grade: string; previous: number | null; summary: string };
  pillars: { label: string; score: number; weight: number }[];
  aiAccess: { label: string; vendor: string; allowed: boolean }[];
  issues: {
    title: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    pillarLabel: string;
    whatItMeans: string;
    whyItMatters: string;
    howToFix: string;
    codeSnippet: string | null;
    impactPoints: number;
    priorityScore: number;
    affectedCount: number;
    affectedSample: string[];
  }[];
  actionPlan: { title: string; detail: string; timeframe: string }[];
  pagesCrawled: number;
  generatedAt: Date;
};

export type CitationReportData = {
  site: { name: string; origin: string; brandName: string };
  visibility: { checks: number; cited: number; visibility: number; avgSov: number };
  anySimulated: boolean;
  byEngine: { engine: EngineId; checks: number; cited: number; visibility: number }[];
  prompts: {
    prompt: string;
    results: { engine: EngineId; cited: boolean; position: number | null; sov: number; mode: string }[];
  }[];
  benchmark: { name: string; isBrand: boolean; mentions: number; presence: number }[];
  history: { day: string; visibility: number }[];
  generatedAt: Date;
};

const INK: Rgb = [0.12, 0.13, 0.16];
const MUTED: Rgb = [0.42, 0.45, 0.5];
const FAINT: Rgb = [0.6, 0.63, 0.68];
const RED: Rgb = [0.86, 0.15, 0.15];
const AMBER: Rgb = [0.85, 0.47, 0.04];
const GREEN: Rgb = [0.09, 0.6, 0.41];

const SEVERITY_COLOUR: Record<string, Rgb> = {
  critical: RED,
  high: [0.91, 0.34, 0.13],
  medium: AMBER,
  low: [0.37, 0.45, 0.55],
};

const EFFORT_LABEL: Record<string, string> = {
  low: 'Quick win',
  medium: 'Half-day',
  high: 'Dev project',
};

function scoreColour(score: number): Rgb {
  if (score >= 80) return GREEN;
  if (score >= 60) return [0.4, 0.6, 0.2];
  if (score >= 40) return AMBER;
  return RED;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Report masthead. Logos are not embedded (no image support); the name is set as a wordmark. */
function header(doc: PdfDoc, branding: Branding, title: string, subtitle: string): void {
  const accent = hexToRgb(branding.brandColour);
  doc.rect(0, 841.89 - 6, 595.28, 6, accent);
  doc.space(6);
  doc.text(branding.productName, { size: 10, bold: true, colour: accent });
  doc.space(2);
  doc.text(title, { size: 23, bold: true, colour: INK });
  doc.text(subtitle, { size: 10.5, colour: MUTED });
  doc.space(6);
  doc.rule();
  doc.space(4);
}

function sectionTitle(doc: PdfDoc, text: string, accent: Rgb): void {
  doc.ensure(40);
  doc.space(8);
  doc.text(text, { size: 13.5, bold: true, colour: INK });
  doc.rect(doc.left, doc.cursorY + 6, 28, 2.5, accent);
  doc.space(8);
}

/** Big score block: ring, grade, movement against the previous audit. */
function scoreBlock(doc: PdfDoc, score: AuditReportData['score']): void {
  doc.ensure(130);
  const top = doc.cursorY;
  const cx = doc.left + 46;
  const cy = top - 46;
  const colour = scoreColour(score.overall);

  doc.circle(cx, cy, 44, tint(colour, 0.85));
  doc.circle(cx, cy, 36, [1, 1, 1]);
  const label = String(score.overall);
  doc.textAt(label, cx - measure(label, 30, true) / 2, cy - 6, {
    size: 30,
    bold: true,
    colour,
  });
  doc.textAt('/100', cx - measure('/100', 8, false) / 2, cy - 22, { size: 8, colour: MUTED });

  const textX = doc.left + 108;
  const textW = doc.right - textX;
  doc.textAt(`Grade ${score.grade}`, textX, top - 16, { size: 15, bold: true, colour: INK });

  if (score.previous !== null) {
    const delta = score.overall - score.previous;
    const sign = delta > 0 ? '+' : '';
    const dColour = delta > 0 ? GREEN : delta < 0 ? RED : MUTED;
    doc.textAt(
      `${sign}${delta} since last audit (was ${score.previous})`,
      textX + measure(`Grade ${score.grade}`, 15, true) + 10,
      top - 15,
      { size: 9, bold: true, colour: dColour },
    );
  }

  // Summary wrapped manually so it sits beside the ring rather than under it.
  let y = top - 36;
  for (const line of wrap(score.summary, 9.5, textW)) {
    doc.textAt(line, textX, y, { size: 9.5, colour: MUTED });
    y -= 13.5;
    if (y < top - 92) break;
  }

  doc.space(104);
}

function wrap(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (measure(candidate, size, false) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ───────────────────────────── audit report ──────────────────────────────

export function buildAuditReport(data: AuditReportData, branding: Branding): Buffer {
  const accent = hexToRgb(branding.brandColour);
  const doc = new PdfDoc(`AI Search Visibility Report — ${data.site.name}`);

  doc.setFooter((p, t) =>
    branding.footer
      ? `${branding.footer}  ·  ${hostOf(data.site.origin)}  ·  ${fmtDate(data.generatedAt)}`
      : `${branding.productName}  ·  ${hostOf(data.site.origin)}  ·  ${fmtDate(data.generatedAt)}  ·  ${p}/${t}`,
  );

  header(
    doc,
    branding,
    'AI Search Visibility Report',
    `${data.site.name} — ${hostOf(data.site.origin)} · ${data.pagesCrawled} page${data.pagesCrawled === 1 ? '' : 's'} analysed · ${fmtDate(data.generatedAt)}`,
  );

  scoreBlock(doc, data.score);

  // Pillars
  sectionTitle(doc, 'Where the score comes from', accent);
  for (const p of data.pillars) {
    doc.bar(`${p.label}  (${p.weight}% weight)`, p.score, 100, scoreColour(p.score), {
      suffix: '/100',
      labelWidth: 200,
    });
  }

  // AI crawler access matrix — the thing clients most need to see.
  sectionTitle(doc, 'Can the AI crawlers reach you?', accent);
  const blocked = data.aiAccess.filter((a) => !a.allowed);
  doc.text(
    blocked.length
      ? `${blocked.length} of ${data.aiAccess.length} AI crawlers are blocked by robots.txt: ${blocked.map((b) => b.label).join(', ')}. Until that is changed, those engines cannot read this site at all.`
      : `All ${data.aiAccess.length} AI crawlers checked are allowed to read the site.`,
    { size: 9.5, colour: MUTED },
  );
  doc.space(6);

  for (const a of data.aiAccess) {
    doc.ensure(16);
    const y = doc.cursorY - 10;
    const colour = a.allowed ? GREEN : RED;
    doc.rect(doc.left, y + 1, 3, 9, colour);
    doc.textAt(a.label, doc.left + 10, y + 1.5, { size: 9, bold: true });
    doc.textAt(a.vendor, doc.left + 130, y + 1.5, { size: 9, colour: MUTED });
    doc.textAt(a.allowed ? 'Allowed' : 'BLOCKED', doc.left + 240, y + 1.5, {
      size: 9,
      bold: true,
      colour,
    });
    doc.space(15);
  }

  // Action plan
  if (data.actionPlan.length) {
    sectionTitle(doc, 'What to do, in order', accent);
    for (const [i, step] of data.actionPlan.entries()) {
      doc.ensure(50);
      const y = doc.cursorY;
      doc.circle(doc.left + 7, y - 7, 8, tint(accent, 0.82));
      doc.textAt(String(i + 1), doc.left + 4.6, y - 10, { size: 9, bold: true, colour: accent });
      doc.textAt(step.title, doc.left + 22, y - 10, {
        size: 10.5,
        bold: true,
        maxWidth: doc.contentWidth - 110,
      });
      doc.tag(step.timeframe.toUpperCase(), doc.right - 78, y - 10, tint(accent, 0.88), accent);
      doc.space(18);
      doc.text(step.detail, { size: 9.5, colour: MUTED, x: doc.left + 22, maxWidth: doc.contentWidth - 22 });
      doc.space(6);
    }
  }

  // Prioritised fixes — the core of the report.
  doc.newPage();
  header(doc, branding, 'Prioritised fixes', 'Ranked by score impact divided by effort to fix.');

  if (!data.issues.length) {
    doc.text('No issues found. Everything checked passed.', { size: 11, colour: GREEN });
  }

  for (const [i, issue] of data.issues.entries()) {
    doc.ensure(150);
    const sevColour = SEVERITY_COLOUR[issue.severity] ?? MUTED;

    doc.rect(doc.left, doc.cursorY - 20, doc.contentWidth, 0.75, [0.9, 0.91, 0.93]);
    doc.space(12);

    const y = doc.cursorY;
    doc.textAt(`${i + 1}.`, doc.left, y - 11, { size: 11, bold: true, colour: FAINT });
    doc.textAt(issue.title, doc.left + 20, y - 11, {
      size: 11.5,
      bold: true,
      maxWidth: doc.contentWidth - 150,
    });
    doc.space(20);

    // Tag row: severity, effort, impact
    let x = doc.left + 20;
    x += doc.tag(issue.severity.toUpperCase(), x, doc.cursorY, tint(sevColour, 0.86), sevColour) + 5;
    x += doc.tag(
      (EFFORT_LABEL[issue.effort] ?? issue.effort).toUpperCase(),
      x,
      doc.cursorY,
      [0.94, 0.95, 0.96],
      [0.35, 0.38, 0.44],
    ) + 5;
    doc.tag(
      `+${issue.impactPoints.toFixed(1)} PTS`,
      x,
      doc.cursorY,
      tint(accent, 0.88),
      accent,
    );
    doc.textAt(issue.pillarLabel, doc.right - measure(issue.pillarLabel, 8, false), doc.cursorY + 1, {
      size: 8,
      colour: FAINT,
    });
    doc.space(18);

    const bodyX = doc.left + 20;
    const bodyW = doc.contentWidth - 20;

    doc.text(issue.whatItMeans, { size: 9.5, colour: INK, x: bodyX, maxWidth: bodyW });
    doc.space(4);
    doc.text(`Why it matters: ${issue.whyItMatters}`, {
      size: 9,
      colour: MUTED,
      x: bodyX,
      maxWidth: bodyW,
    });
    doc.space(4);
    doc.text(`How to fix: ${issue.howToFix}`, { size: 9, colour: INK, x: bodyX, maxWidth: bodyW });

    if (issue.affectedSample.length) {
      doc.space(4);
      doc.text(
        `Affected (${issue.affectedCount}): ${issue.affectedSample.slice(0, 4).join(', ')}${issue.affectedCount > 4 ? ', …' : ''}`,
        { size: 8.5, colour: FAINT, x: bodyX, maxWidth: bodyW },
      );
    }

    if (issue.codeSnippet) {
      doc.space(6);
      const lines = issue.codeSnippet.split('\n').slice(0, 18);
      const boxH = lines.length * 10.5 + 10;
      doc.ensure(boxH + 8);
      doc.rect(bodyX, doc.cursorY - boxH, bodyW, boxH, [0.97, 0.975, 0.98]);
      doc.rect(bodyX, doc.cursorY - boxH, 2.5, boxH, tint(accent, 0.5));
      let ly = doc.cursorY - 14;
      for (const line of lines) {
        doc.textAt(line, bodyX + 10, ly, { size: 8, colour: [0.2, 0.22, 0.28], maxWidth: bodyW - 20 });
        ly -= 10.5;
      }
      doc.space(boxH + 6);
    }

    doc.space(8);
  }

  if (branding.contact) {
    doc.space(14);
    doc.rule();
    doc.text(branding.contact, { size: 9, colour: MUTED });
  }

  if (!branding.whiteLabel) {
    doc.space(10);
    doc.text('Generated by Citation Radar — citationradar.app', { size: 8, colour: FAINT });
  }

  return doc.build();
}

// ─────────────────────────── citation report ─────────────────────────────

export function buildCitationReport(data: CitationReportData, branding: Branding): Buffer {
  const accent = hexToRgb(branding.brandColour);
  const doc = new PdfDoc(`AI Citation Report — ${data.site.name}`);

  doc.setFooter((p, t) =>
    branding.footer
      ? `${branding.footer}  ·  ${hostOf(data.site.origin)}  ·  ${fmtDate(data.generatedAt)}`
      : `${branding.productName}  ·  ${hostOf(data.site.origin)}  ·  ${fmtDate(data.generatedAt)}  ·  ${p}/${t}`,
  );

  header(
    doc,
    branding,
    'AI Citation Report',
    `${data.site.name} — tracking "${data.site.brandName}" across AI answer engines · ${fmtDate(data.generatedAt)}`,
  );

  if (data.anySimulated) {
    doc.ensure(34);
    doc.rect(doc.left, doc.cursorY - 28, doc.contentWidth, 28, [1, 0.97, 0.9]);
    doc.rect(doc.left, doc.cursorY - 28, 3, 28, AMBER);
    doc.textAt('SIMULATED DATA', doc.left + 12, doc.cursorY - 12, {
      size: 8.5,
      bold: true,
      colour: AMBER,
    });
    doc.textAt(
      'Some or all checks ran without live engine API keys. Figures are illustrative, not measured.',
      doc.left + 12,
      doc.cursorY - 23,
      { size: 8.5, colour: [0.45, 0.35, 0.1], maxWidth: doc.contentWidth - 24 },
    );
    doc.space(36);
  }

  // Headline numbers
  doc.ensure(78);
  const cards: [string, string, string][] = [
    ['Visibility', `${data.visibility.visibility}%`, 'of tracked prompt/engine pairs cite you'],
    ['Share of voice', `${data.visibility.avgSov}%`, 'of brand mentions are yours'],
    ['Cited', `${data.visibility.cited}/${data.visibility.checks}`, 'checks naming your brand'],
  ];
  const cardW = (doc.contentWidth - 16) / 3;
  const cardTop = doc.cursorY;
  for (const [i, [label, value, note]] of cards.entries()) {
    const x = doc.left + i * (cardW + 8);
    doc.rect(x, cardTop - 66, cardW, 66, [0.975, 0.977, 0.985]);
    doc.rect(x, cardTop - 66, cardW, 2.5, accent);
    doc.textAt(label.toUpperCase(), x + 12, cardTop - 22, { size: 7.5, bold: true, colour: FAINT });
    doc.textAt(value, x + 12, cardTop - 44, { size: 20, bold: true, colour: INK });
    doc.textAt(note, x + 12, cardTop - 58, { size: 7.5, colour: MUTED, maxWidth: cardW - 24 });
  }
  doc.space(78);

  // Per engine
  sectionTitle(doc, 'Visibility by engine', accent);
  for (const e of data.byEngine) {
    doc.bar(`${ENGINE_LABELS[e.engine]}  (${e.cited}/${e.checks} cited)`, e.visibility, 100, accent, {
      suffix: '%',
      labelWidth: 200,
    });
  }

  // History sparkline
  if (data.history.length > 1) {
    sectionTitle(doc, 'Visibility over time', accent);
    doc.ensure(90);
    const chartTop = doc.cursorY;
    const chartH = 70;
    const chartW = doc.contentWidth;
    doc.rect(doc.left, chartTop - chartH, chartW, chartH, [0.98, 0.98, 0.99]);
    const step = data.history.length > 1 ? chartW / (data.history.length - 1) : chartW;
    const barW = Math.max(2, Math.min(14, step * 0.6));
    for (const [i, point] of data.history.entries()) {
      const h = (Math.max(0, Math.min(100, point.visibility)) / 100) * (chartH - 10);
      const x = doc.left + i * step - barW / 2;
      doc.rect(Math.max(doc.left, x), chartTop - chartH, barW, h, accent);
    }
    doc.textAt(data.history[0]!.day, doc.left, chartTop - chartH - 11, { size: 7.5, colour: FAINT });
    const lastDay = data.history[data.history.length - 1]!.day;
    doc.textAt(lastDay, doc.right - measure(lastDay, 7.5, false), chartTop - chartH - 11, {
      size: 7.5,
      colour: FAINT,
    });
    doc.space(chartH + 20);
  }

  // Competitor benchmark
  if (data.benchmark.length) {
    sectionTitle(doc, 'Share of voice against competitors', accent);
    const maxMentions = Math.max(...data.benchmark.map((b) => b.mentions), 1);
    for (const row of data.benchmark.slice(0, 12)) {
      doc.bar(
        `${row.isBrand ? `${row.name} (you)` : row.name}  —  seen in ${row.presence}% of checks`,
        row.mentions,
        maxMentions,
        row.isBrand ? accent : [0.72, 0.74, 0.78],
        { labelWidth: 230 },
      );
    }
  }

  // Prompt-level table
  doc.newPage();
  header(doc, branding, 'Prompt-level results', 'The most recent check for every tracked prompt and engine.');

  const engines = [...new Set(data.prompts.flatMap((p) => p.results.map((r) => r.engine)))];
  const colW = 74;
  const promptW = doc.contentWidth - engines.length * colW;

  doc.ensure(24);
  const headY = doc.cursorY - 12;
  doc.textAt('PROMPT', doc.left, headY, { size: 7.5, bold: true, colour: FAINT });
  for (const [i, e] of engines.entries()) {
    doc.textAt(ENGINE_LABELS[e].toUpperCase(), doc.left + promptW + i * colW, headY, {
      size: 7.5,
      bold: true,
      colour: FAINT,
      maxWidth: colW - 6,
    });
  }
  doc.space(16);
  doc.rule();

  for (const p of data.prompts) {
    doc.ensure(22);
    const y = doc.cursorY - 11;
    doc.textAt(p.prompt, doc.left, y, { size: 8.5, maxWidth: promptW - 10 });
    for (const [i, e] of engines.entries()) {
      const r = p.results.find((x) => x.engine === e);
      const x = doc.left + promptW + i * colW;
      if (!r) {
        doc.textAt('—', x, y, { size: 8.5, colour: FAINT });
        continue;
      }
      doc.textAt(r.cited ? 'Cited' : 'Not cited', x, y, {
        size: 8.5,
        bold: r.cited,
        colour: r.cited ? GREEN : FAINT,
      });
      if (r.cited) {
        doc.textAt(
          `#${r.position ?? '?'} · ${Math.round(r.sov * 100)}% SoV`,
          x,
          y - 9,
          { size: 7, colour: MUTED },
        );
      }
    }
    doc.space(24);
  }

  if (branding.contact) {
    doc.space(14);
    doc.rule();
    doc.text(branding.contact, { size: 9, colour: MUTED });
  }
  if (!branding.whiteLabel) {
    doc.space(10);
    doc.text('Generated by Citation Radar — citationradar.app', { size: 8, colour: FAINT });
  }

  return doc.build();
}
