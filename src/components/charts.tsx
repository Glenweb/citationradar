import { scoreHex } from './ui';

/*
 * Charts as inline SVG.
 *
 * These render in server components, need no client JavaScript, and because they are
 * plain markup they also survive the browser's own print-to-PDF. A charting library
 * would have cost a client bundle and a hydration boundary for what is, here, arithmetic.
 */

/** The headline score ring. `size` is the outer diameter in px. */
export function ScoreRing({
  score,
  size = 132,
  label,
  grade,
}: {
  score: number;
  size?: number;
  label?: string;
  grade?: string;
}) {
  const stroke = Math.max(8, Math.round(size * 0.085));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const dash = (clamped / 100) * circumference;
  const colour = scoreHex(clamped);

  return (
    <div className="relative inline-flex shrink-0 items-center justify-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`AEO score ${clamped} out of 100${grade ? `, grade ${grade}` : ''}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          // Start the arc at 12 o'clock rather than 3.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-bold tabular-nums leading-none"
          style={{ color: colour, fontSize: size * 0.3 }}
        >
          {clamped}
        </span>
        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-400">
          {label ?? '/ 100'}
        </span>
      </div>
    </div>
  );
}

export function PillarBars({
  pillars,
}: {
  pillars: { id?: string; label: string; score: number; weight: number; blurb?: string }[];
}) {
  return (
    <ul className="divide-y divide-ink-100">
      {pillars.map((p) => (
        <li key={p.id ?? p.label} className="px-5 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-ink-800">{p.label}</p>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">
              {p.score}
              <span className="text-xs font-normal text-ink-400">/100</span>
            </p>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100"
              role="meter"
              aria-valuenow={p.score}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={p.label}
            >
              <div
                className="h-full rounded-full transition-[width]"
                style={{ width: `${Math.max(1, p.score)}%`, background: scoreHex(p.score) }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-[11px] text-ink-400">
              {p.weight}% weight
            </span>
          </div>
          {p.blurb ? <p className="mt-1.5 text-xs text-ink-500">{p.blurb}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export type HistoryPoint = { day: string; visibility: number; sov?: number };

/**
 * Visibility over time. A line for percentage-cited with an area fill, plus optional
 * share-of-voice as a second line. Points are plotted on an index scale rather than a
 * time scale, because checks are weekly and evenly spaced in practice.
 */
export function VisibilityChart({
  points,
  height = 180,
  showSov = true,
}: {
  points: HistoryPoint[];
  height?: number;
  showSov?: boolean;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-ink-400">
        No checks recorded yet.
      </div>
    );
  }

  const w = 720;
  const h = height;
  const pad = { top: 12, right: 12, bottom: 26, left: 34 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  // A single point has no line to draw, so it is rendered as a lone marker.
  const x = (i: number) =>
    points.length === 1 ? pad.left + innerW / 2 : pad.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;

  const line = (key: 'visibility' | 'sov') =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key] ?? 0).toFixed(1)}`)
      .join(' ');

  const area = `${line('visibility')} L ${x(points.length - 1).toFixed(1)} ${pad.top + innerH} L ${x(0).toFixed(1)} ${pad.top + innerH} Z`;
  const hasSov = showSov && points.some((p) => typeof p.sov === 'number');

  return (
    <figure className="px-2 pb-1">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Visibility from ${points[0]!.day} to ${points[points.length - 1]!.day}`}
      >
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={w - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#e2e8f0"
              strokeWidth={1}
              strokeDasharray={tick === 0 ? undefined : '3 3'}
            />
            <text x={pad.left - 7} y={y(tick) + 3.5} textAnchor="end" fontSize="9" fill="#94a3b8">
              {tick}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id="vizFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#vizFill)" />
        <path d={line('visibility')} fill="none" stroke="#4f46e5" strokeWidth={2.25} strokeLinejoin="round" />
        {hasSov ? (
          <path
            d={line('sov')}
            fill="none"
            stroke="#0d9488"
            strokeWidth={1.75}
            strokeDasharray="5 3"
          />
        ) : null}

        {points.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.visibility)} r={points.length > 40 ? 1.5 : 3} fill="#4f46e5" />
        ))}

        <text x={pad.left} y={h - 8} fontSize="9" fill="#94a3b8">
          {points[0]!.day}
        </text>
        {points.length > 1 ? (
          <text x={w - pad.right} y={h - 8} fontSize="9" fill="#94a3b8" textAnchor="end">
            {points[points.length - 1]!.day}
          </text>
        ) : null}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-4 px-1 text-[11px] text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded bg-brand-600" />
          Visibility (% of checks citing you)
        </span>
        {hasSov ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded bg-teal-600 opacity-80" />
            Share of voice
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** Horizontal share-of-voice comparison; the tracked brand is highlighted. */
export function BenchmarkBars({
  rows,
}: {
  rows: { name: string; isBrand: boolean; mentions: number; presence: number }[];
}) {
  if (!rows.length) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-ink-400">
        Add competitors and run a check to see the benchmark.
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => r.mentions), 1);

  return (
    <ul className="divide-y divide-ink-100">
      {rows.map((row) => (
        <li key={row.name} className="flex items-center gap-3 px-5 py-3">
          <div className="w-40 shrink-0 truncate text-sm">
            <span className={row.isBrand ? 'font-semibold text-ink-900' : 'text-ink-700'}>
              {row.name}
            </span>
            {row.isBrand ? <span className="ml-1.5 text-[11px] text-brand-600">you</span> : null}
          </div>
          <div className="h-5 flex-1 overflow-hidden rounded bg-ink-100">
            <div
              className={`h-full rounded ${row.isBrand ? 'bg-brand-600' : 'bg-ink-300'}`}
              style={{ width: `${Math.max(2, (row.mentions / max) * 100)}%` }}
            />
          </div>
          <div className="w-28 shrink-0 text-right text-xs tabular-nums text-ink-500">
            <span className="font-semibold text-ink-800">{row.mentions}</span> mentions
            <span className="block text-[11px]">in {row.presence}% of checks</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Compact per-engine visibility column, used on the dashboard and tracker. */
export function EngineBars({
  rows,
}: {
  rows: { label: string; visibility: number; checks: number; cited: number; simulated?: boolean }[];
}) {
  if (!rows.length) {
    return <p className="px-5 py-6 text-sm text-ink-400">No checks yet.</p>;
  }
  return (
    <ul className="divide-y divide-ink-100">
      {rows.map((r) => (
        <li key={r.label} className="px-5 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm text-ink-800">
              {r.label}
              {r.simulated ? (
                <span className="ml-1.5 text-[10px] font-semibold uppercase text-amber-600">sim</span>
              ) : null}
            </p>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">
              {r.visibility}%
            </p>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${Math.max(1, r.visibility)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-400">
            {r.cited} of {r.checks} prompts cited
          </p>
        </li>
      ))}
    </ul>
  );
}
