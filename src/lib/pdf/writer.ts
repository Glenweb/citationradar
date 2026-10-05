/**
 * A minimal PDF writer.
 *
 * Why hand-rolled: report export has to run in a serverless function, so a headless
 * browser is out, and the PDF libraries that remain either pull in a large dependency
 * tree or need font files on disk. What a branded audit report actually needs is text
 * in the 14 standard PDF fonts, rules, filled rectangles and circles — a few hundred
 * lines of content-stream generation. This keeps the export path dependency-free and
 * fast, at the cost of no image embedding (logos are rendered as a coloured wordmark).
 *
 * Emits PDF 1.4 with Helvetica/Helvetica-Bold and WinAnsiEncoding.
 */

export type Rgb = [number, number, number];

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait, points
const MARGIN = { top: 56, right: 48, bottom: 56, left: 48 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

type Op = string;

export class PdfDoc {
  private pages: Op[][] = [];
  private current: Op[] = [];
  private y = PAGE.height - MARGIN.top;
  private title = 'Report';
  private footerFn: ((page: number, total: number) => string) | null = null;

  constructor(title?: string) {
    if (title) this.title = title;
    this.pages.push(this.current);
  }

  // ── geometry ────────────────────────────────────────────────────────────

  get cursorY(): number {
    return this.y;
  }

  get contentWidth(): number {
    return CONTENT_WIDTH;
  }

  get left(): number {
    return MARGIN.left;
  }

  get right(): number {
    return PAGE.width - MARGIN.right;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Move the cursor down, breaking the page if the next block would not fit. */
  space(h: number): void {
    this.y -= h;
    if (this.y < MARGIN.bottom) this.newPage();
  }

  /** Ensure `h` points remain on this page; otherwise start a new one. */
  ensure(h: number): void {
    if (this.y - h < MARGIN.bottom) this.newPage();
  }

  newPage(): void {
    this.current = [];
    this.pages.push(this.current);
    this.y = PAGE.height - MARGIN.top;
  }

  setFooter(fn: (page: number, total: number) => string): void {
    this.footerFn = fn;
  }

  // ── drawing ─────────────────────────────────────────────────────────────

  text(
    value: string,
    opts: {
      size?: number;
      bold?: boolean;
      colour?: Rgb;
      x?: number;
      lineHeight?: number;
      maxWidth?: number;
      align?: 'left' | 'right' | 'center';
    } = {},
  ): void {
    const size = opts.size ?? 10;
    const bold = opts.bold ?? false;
    const colour = opts.colour ?? [0.12, 0.13, 0.16];
    const lineHeight = opts.lineHeight ?? size * 1.45;
    const maxWidth = opts.maxWidth ?? CONTENT_WIDTH;
    const lines = wrapText(value, size, bold, maxWidth);

    for (const line of lines) {
      this.ensure(lineHeight);
      const w = measure(line, size, bold);
      let x = opts.x ?? MARGIN.left;
      if (opts.align === 'right') x = this.right - w;
      else if (opts.align === 'center') x = MARGIN.left + (maxWidth - w) / 2;

      this.current.push(
        `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(colour)} rg 1 0 0 1 ${f(x)} ${f(this.y - size)} Tm (${escapeText(line)}) Tj ET`,
      );
      this.y -= lineHeight;
    }
    if (this.y < MARGIN.bottom) this.newPage();
  }

  /** Single line, no wrapping or cursor movement — for table cells. */
  textAt(
    value: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; colour?: Rgb; maxWidth?: number } = {},
  ): void {
    const size = opts.size ?? 9;
    const bold = opts.bold ?? false;
    const colour = opts.colour ?? [0.12, 0.13, 0.16];
    const shown = opts.maxWidth ? truncate(value, size, bold, opts.maxWidth) : value;
    this.current.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(colour)} rg 1 0 0 1 ${f(x)} ${f(y)} Tm (${escapeText(shown)}) Tj ET`,
    );
  }

  rect(x: number, y: number, w: number, h: number, colour: Rgb): void {
    this.current.push(`${rgb(colour)} rg ${f(x)} ${f(y)} ${f(w)} ${f(h)} re f`);
  }

  rule(colour: Rgb = [0.88, 0.89, 0.92], thickness = 0.75): void {
    this.ensure(thickness + 4);
    this.current.push(
      `${rgb(colour)} RG ${f(thickness)} w ${f(MARGIN.left)} ${f(this.y)} m ${f(this.right)} ${f(this.y)} l S`,
    );
    this.y -= thickness + 4;
  }

  /** Filled circle via four Bézier arcs — used for the score ring. */
  circle(cx: number, cy: number, r: number, colour: Rgb, filled = true): void {
    const k = 0.5523 * r;
    const ops = [
      `${f(cx + r)} ${f(cy)} m`,
      `${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c`,
      `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c`,
      `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c`,
      `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c`,
    ].join(' ');
    this.current.push(
      filled ? `${rgb(colour)} rg ${ops} f` : `${rgb(colour)} RG 2 w ${ops} S`,
    );
  }

  /** Horizontal bar with a label and value — the pillar and benchmark rows. */
  bar(
    label: string,
    value: number,
    max: number,
    colour: Rgb,
    opts: { suffix?: string; labelWidth?: number; height?: number } = {},
  ): void {
    const h = opts.height ?? 11;
    const labelWidth = opts.labelWidth ?? 170;
    this.ensure(h + 10);
    const top = this.y - h;
    const trackX = MARGIN.left + labelWidth;
    const trackW = this.right - trackX - 46;
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;

    this.textAt(label, MARGIN.left, top + 2.5, { size: 9, maxWidth: labelWidth - 8 });
    this.rect(trackX, top, trackW, h, [0.93, 0.94, 0.96]);
    if (ratio > 0) this.rect(trackX, top, trackW * ratio, h, colour);
    this.textAt(`${Math.round(value)}${opts.suffix ?? ''}`, trackX + trackW + 8, top + 2.5, {
      size: 9,
      bold: true,
    });

    this.y -= h + 7;
    if (this.y < MARGIN.bottom) this.newPage();
  }

  /** A pill-shaped tag, returning the width consumed. */
  tag(text: string, x: number, y: number, bg: Rgb, fg: Rgb): number {
    const size = 7.5;
    const padding = 5;
    const w = measure(text, size, true) + padding * 2;
    this.rect(x, y - 2, w, 12, bg);
    this.textAt(text, x + padding, y + 1, { size, bold: true, colour: fg });
    return w;
  }

  // ── serialisation ───────────────────────────────────────────────────────

  build(): Buffer {
    if (this.footerFn) this.stampFooters();

    const objects: string[] = [];
    const pageCount = this.pages.length;
    // 1: Catalog, 2: Pages, 3: F1, 4: F2, then (content, page) per page.
    const firstContent = 5;

    const kids = this.pages
      .map((_, i) => `${firstContent + i * 2 + 1} 0 R`)
      .join(' ');

    objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
    objects.push(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    );
    objects.push(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
    );

    for (const [i, ops] of this.pages.entries()) {
      const stream = ops.join('\n');
      objects.push(
        `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
      );
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(PAGE.width)} ${f(PAGE.height)}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${firstContent + i * 2} 0 R >>`,
      );
    }

    const infoIndex = objects.length + 1;
    objects.push(
      `<< /Title (${escapeText(this.title)}) /Producer (Citation Radar) /Creator (Citation Radar) >>`,
    );

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (const [i, body] of objects.entries()) {
      offsets.push(Buffer.byteLength(pdf, 'latin1'));
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) {
      pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    pdf +=
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoIndex} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(pdf, 'latin1');
  }

  private stampFooters(): void {
    const total = this.pages.length;
    for (const [i, ops] of this.pages.entries()) {
      const label = this.footerFn!(i + 1, total);
      const size = 7.5;
      ops.push(
        `${rgb([0.88, 0.89, 0.92])} RG 0.5 w ${f(MARGIN.left)} ${f(MARGIN.bottom - 14)} m ` +
          `${f(PAGE.width - MARGIN.right)} ${f(MARGIN.bottom - 14)} l S`,
      );
      ops.push(
        `BT /F1 ${size} Tf ${rgb([0.47, 0.5, 0.56])} rg 1 0 0 1 ${f(MARGIN.left)} ` +
          `${f(MARGIN.bottom - 26)} Tm (${escapeText(label)}) Tj ET`,
      );
      const pageLabel = `${i + 1} / ${total}`;
      ops.push(
        `BT /F1 ${size} Tf ${rgb([0.47, 0.5, 0.56])} rg 1 0 0 1 ` +
          `${f(PAGE.width - MARGIN.right - measure(pageLabel, size, false))} ` +
          `${f(MARGIN.bottom - 26)} Tm (${escapeText(pageLabel)}) Tj ET`,
      );
    }
  }
}

// ── text metrics ──────────────────────────────────────────────────────────

/**
 * Helvetica advance widths (units/1000) for the printable WinAnsi range. Without these
 * every line would have to be guessed at, and wrapping would be visibly wrong.
 */
const W_REGULAR: Record<string, number> = buildWidths(
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~',
  [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ],
);

const W_BOLD: Record<string, number> = buildWidths(
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~',
  [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ],
);

function buildWidths(chars: string, widths: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < chars.length; i += 1) {
    out[chars[i]!] = widths[i] ?? 556;
  }
  return out;
}

export function measure(text: string, size: number, bold: boolean): number {
  const table = bold ? W_BOLD : W_REGULAR;
  let total = 0;
  for (const ch of text) total += table[ch] ?? 556;
  return (total / 1000) * size;
}

/** Greedy word wrap, breaking over-long single words character by character. */
export function wrapText(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size, bold) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      if (measure(word, size, bold) <= maxWidth) {
        line = word;
      } else {
        let chunk = '';
        for (const ch of word) {
          if (measure(chunk + ch, size, bold) > maxWidth) {
            out.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function truncate(text: string, size: number, bold: boolean, maxWidth: number): string {
  if (measure(text, size, bold) <= maxWidth) return text;
  let out = '';
  for (const ch of text) {
    if (measure(`${out}${ch}…`, size, bold) > maxWidth) break;
    out += ch;
  }
  return `${out}…`;
}

// ── encoding helpers ──────────────────────────────────────────────────────

/** Map to WinAnsi where possible; drop anything unrepresentable. */
const TRANSLITERATE: Record<string, string> = {
  '…': '...',
  '—': '-',
  '–': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '→': '->',
  '✓': 'v',
  '✗': 'x',
  '·': '-',
  '•': '-',
  '≥': '>=',
  '≤': '<=',
  '×': 'x',
  '÷': '/',
  '£': '£',
  '€': '\u0080',
  '™': '(TM)',
  '®': '®',
  '©': '©',
};

function escapeText(text: string): string {
  let out = '';
  for (const ch of text) {
    const mapped = TRANSLITERATE[ch] ?? ch;
    for (const c of mapped) {
      const code = c.codePointAt(0) ?? 63;
      if (c === '(' || c === ')' || c === '\\') out += `\\${c}`;
      else if (code < 32) out += ' ';
      else if (code < 127) out += c;
      else if (code <= 255) out += `\\${code.toString(8).padStart(3, '0')}`;
      else out += '?';
    }
  }
  return out;
}

function f(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '0';
}

function rgb([r, g, b]: Rgb): string {
  return `${f(clamp(r))} ${f(clamp(g))} ${f(clamp(b))}`;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Parse `#rrggbb` into a PDF colour triple, falling back to indigo. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return [0.31, 0.275, 0.898];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Lighten a colour towards white — used for bar tracks and tag backgrounds. */
export function tint(colour: Rgb, amount: number): Rgb {
  return colour.map((c) => c + (1 - c) * amount) as Rgb;
}
