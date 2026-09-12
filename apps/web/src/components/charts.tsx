import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatCents } from '@budjo/shared';

/**
 * Hand-rolled SVG rather than a charting library.
 *
 * The specs these charts follow — bars capped at 24px with a 4px rounded
 * data-end square at the baseline, a 2px surface gap between touching marks, 2px
 * lines, markers with a 2px surface ring, hairline solid chrome — are easier to
 * hit exactly by hand than to extract from a library's defaults, and it keeps a
 * ~100KB dependency out of a bundle this app doesn't need.
 *
 * Series colours come from --series-N (validated against this app's surfaces in
 * index.css). Text never wears a series colour: identity is carried by the
 * coloured mark beside it.
 */

const PAD = { top: 12, right: 14, bottom: 26, left: 46 };

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Axis ticks round to clean numbers; they carry the values not directly labelled. */
function ticks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

const shortMonth = (period: string) =>
  new Date(`${period}-01T12:00:00Z`).toLocaleDateString([], { month: 'short', timeZone: 'UTC' });

/**
 * The chart's own width in CSS pixels, so the viewBox can be 1:1 with the
 * screen. A fixed viewBox scaled to fit shrinks the type with the chart — on a
 * 375px phone a 10px axis label rendered at 4px, which is unreadable. Sizing the
 * coordinate space to the container keeps declared font sizes honest at every
 * width, and keeps hairlines crisp instead of upscaled.
 */
function useMeasuredWidth(fallback = 760) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  const measure = useCallback(() => {
    const w = ref.current?.clientWidth;
    if (w && Math.abs(w - width) > 1) setWidth(w);
  }, [width]);

  useEffect(() => {
    measure();
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, width };
}

function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  return {
    tip,
    show: (x: number, y: number, body: ReactNode) => setTip({ x, y, body }),
    hide: () => setTip(null),
  };
}

/**
 * Hit targets as real HTML buttons layered over the plot, rather than
 * transparent SVG rects.
 *
 * A <rect tabindex="0"> is reachable but announces itself as nothing in
 * particular; a button is an interactive control to a screen reader, carries the
 * value in its own accessible name, and gets a focus-visible ring for free. One
 * target per x-position also means a single readout lists every series there, so
 * the pointer never has to land on a particular bar.
 *
 * The viewBox is 1:1 with CSS pixels, so these coordinates are the same numbers
 * the SVG marks use.
 */
function HitLayer({
  targets,
}: {
  targets: {
    key: string;
    left: number;
    width: number;
    top: number;
    height: number;
    label: string;
    onEnter: () => void;
    onLeave: () => void;
  }[];
}) {
  return (
    <div className="absolute inset-0">
      {targets.map((t) => (
        <button
          key={t.key}
          type="button"
          aria-label={t.label}
          className="absolute rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{ left: t.left, width: t.width, top: t.top, height: t.height }}
          onPointerMove={t.onEnter}
          onPointerLeave={t.onLeave}
          onFocus={t.onEnter}
          onBlur={t.onLeave}
        />
      ))}
    </div>
  );
}

function Tooltip({ tip }: { tip: { x: number; y: number; body: ReactNode } | null }) {
  if (!tip) return null;
  return (
    <div
      className="surface pointer-events-none absolute z-10 rounded-lg px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: `${tip.x}%`, top: tip.y, transform: 'translate(-50%, -115%)', minWidth: 96 }}
    >
      {tip.body}
    </div>
  );
}

/** Value leads, series name follows — the reader has the series and wants the number. */
function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} />
        <span className="muted">{label}</span>
      </span>
      <span className="tnum font-medium">{value}</span>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'rect' | 'line' }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="muted flex items-center gap-1.5 text-xs">
          {item.kind === 'line' ? (
            <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: item.color }} />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartFrame({
  title, subtitle, legend, children, note,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className="surface flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {subtitle ? <p className="muted text-xs">{subtitle}</p> : null}
        </div>
        {legend}
      </div>
      {children}
      {note ? <p className="muted text-xs">{note}</p> : null}
    </section>
  );
}

/**
 * The table twin. Every value in every chart is reachable here without hovering,
 * so a tooltip only ever enhances.
 */
export function TableTwin({
  columns, rows,
}: {
  columns: string[];
  rows: (string | number)[][];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="muted text-xs underline decoration-dotted underline-offset-2">
        {open ? 'Hide the numbers' : 'Show the numbers'}
      </button>
      {open ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="muted text-left">
                {columns.map((col, i) => (
                  <th key={col} className={`py-1 font-medium ${i > 0 ? 'text-right' : ''}`}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="border-t border-[var(--border)]">
                  {row.map((cell, i) => (
                    <td key={i} className={`py-1 ${i > 0 ? 'tnum text-right' : ''}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function EmptyPlot({ children }: { children: ReactNode }) {
  return (
    <div className="muted flex h-32 items-center justify-center text-center text-xs">
      {children}
    </div>
  );
}

/**
 * Allocated against spent, by month. Two series of the same unit on one axis —
 * never two scales, which would invent a relationship the data doesn't have.
 */
export function MonthlyColumns({
  rows, height = 200,
}: {
  rows: { period: string; allocatedCents: number; spentCents: number }[];
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();
  const { ref, width: W } = useMeasuredWidth();
  const max = niceCeiling(Math.max(1, ...rows.flatMap((r) => [r.allocatedCents, r.spentCents])));
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const band = plotW / Math.max(rows.length, 1);
  // Capped at 24px, and the band's leftover is left as air rather than filled.
  const barW = Math.min(24, Math.max(6, band / 2 - 5));
  const GAP = 2; // surface gap between the touching pair
  // Month labels collide before the bars do; drop every other one when tight.
  const labelEvery = band < 30 ? 2 : 1;

  return (
    <div className="relative" ref={ref}>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} role="img"
           aria-label="Allocated and spent by month">
        {ticks(max).map((t) => {
          const y = PAD.top + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
                    stroke="var(--grid)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y + 3} textAnchor="end"
                    className="tnum" fill="var(--muted)" fontSize="10">
                {t === 0 ? '0' : `$${Math.round(t / 100).toLocaleString()}`}
              </text>
            </g>
          );
        })}

        {rows.map((row, i) => {
          const cx = PAD.left + band * i + band / 2;
          const pair: [number, string, string][] = [
            [row.allocatedCents, 'var(--series-1)', 'Allocated'],
            [row.spentCents, 'var(--series-2)', 'Spent'],
          ];
          return (
            <g key={row.period}>
              {pair.map(([cents, color, label], k) => {
                const h = Math.max(0, (Math.max(cents, 0) / max) * plotH);
                const x = cx - barW - GAP / 2 + k * (barW + GAP);
                const y = PAD.top + plotH - h;
                return (
                  /* 4px rounded data-end, square at the baseline. */
                  <path key={label} d={roundedTop(x, y, barW, h, 4)} fill={color} />
                );
              })}
              {i % labelEvery === 0 || i === rows.length - 1 ? (
                <text x={cx} y={height - 8} textAnchor="middle" fill="var(--muted)" fontSize="10">
                  {shortMonth(row.period)}
                </text>
              ) : null}
            </g>
          );
        })}

        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH}
              stroke="var(--axis)" strokeWidth="1" />
      </svg>

      {/* One target per month, so one readout lists both series — the pointer
          never has to land on a particular bar. */}
      <HitLayer
        targets={rows.map((row, i) => ({
          key: row.period,
          left: PAD.left + band * i,
          width: band,
          top: PAD.top,
          height: plotH,
          label: `${fullMonth(row.period)}: allocated ${formatCents(row.allocatedCents)}, spent ${formatCents(row.spentCents)}`,
          onEnter: () => show(((PAD.left + band * i + band / 2) / W) * 100, PAD.top, (
            <>
              <div className="mb-1 font-medium">{fullMonth(row.period)}</div>
              <TipRow color="var(--series-1)" label="Allocated" value={formatCents(row.allocatedCents)} />
              <TipRow color="var(--series-2)" label="Spent" value={formatCents(row.spentCents)} />
            </>
          )),
          onLeave: hide,
        }))}
      />
      <Tooltip tip={tip} />
    </div>
  );
}

function pointReadout(p: { period: string; cents: number }) {
  return (
    <>
      <div className="mb-1 font-medium">{fullMonth(p.period)}</div>
      <TipRow color="var(--series-1)" label="Balance" value={formatCents(p.cents)} />
    </>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const radius = Math.min(r, h, w / 2);
  return `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y}` +
         ` L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius}` +
         ` L${x + w},${y + h} Z`;
}

function fullMonth(period: string) {
  return new Date(`${period}-01T12:00:00Z`)
    .toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Magnitude across nominal categories: one series, one colour for every bar.
 * Colouring each bar by its own value would spend the identity channel
 * re-encoding what bar length already shows.
 */
export function CategoryBars({
  rows, unit = 'spent',
}: {
  rows: { label: string; cents: number }[];
  unit?: string;
}) {
  const { tip, show, hide } = useTooltip();
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const ROW = 30;
  const BAR = 18;

  return (
    <div className="relative">
      <div className="flex flex-col">
        {rows.map((row) => {
          const pct = (row.cents / max) * 100;
          return (
            <div
              key={row.label}
              className="flex items-center gap-3 rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
              style={{ height: ROW }}
              tabIndex={0}
              aria-label={`${row.label}: ${formatCents(row.cents)}`}
              onPointerMove={(e) =>
                show(
                  ((e.nativeEvent.offsetX / e.currentTarget.clientWidth) * 100),
                  0,
                  <TipRow color="var(--series-1)" label={row.label} value={formatCents(row.cents)} />,
                )
              }
              onPointerLeave={hide}
              onFocus={() =>
                show(50, 0,
                  <TipRow color="var(--series-1)" label={row.label} value={formatCents(row.cents)} />)
              }
              onBlur={hide}
            >
              <span className="muted w-28 shrink-0 truncate text-xs lg:w-36" title={row.label}>
                {row.label}
              </span>
              <span className="relative flex-1">
                <span
                  className="block"
                  style={{
                    width: `${Math.max(pct, 0.8)}%`,
                    height: BAR,
                    background: 'var(--series-1)',
                    // Square at the baseline, 4px rounded at the data end.
                    borderRadius: '0 4px 4px 0',
                  }}
                />
              </span>
              {/* Direct label at the tip — the relief channel, so no value is
                  reachable only by hover. */}
              <span className="tnum w-20 shrink-0 text-right text-xs">{formatCents(row.cents)}</span>
            </div>
          );
        })}
      </div>
      <span className="sr-only">{unit}</span>
      <Tooltip tip={tip} />
    </div>
  );
}

/**
 * The balance over time — the one chart that answers "are we actually saving?".
 * A single series, so no legend box: the title names it.
 */
export function BalanceLine({
  points, height = 200,
}: {
  points: { period: string; cents: number }[];
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();
  const { ref, width: W } = useMeasuredWidth();
  const gradientId = useId();
  const values = points.map((p) => p.cents);
  const rawMax = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const max = niceCeiling(rawMax);
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const span = max - min || 1;

  const xOf = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (plotW / (points.length - 1)) * i);
  const yOf = (c: number) => PAD.top + plotH - ((c - min) / span) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i)},${yOf(p.cents)}`).join(' ');
  const area = `${line} L${xOf(points.length - 1)},${PAD.top + plotH} L${xOf(0)},${PAD.top + plotH} Z`;
  const step = points.length > 1 ? plotW / (points.length - 1) : plotW;
  const labelEvery = step < 30 ? 2 : 1;

  return (
    <div className="relative" ref={ref}>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} role="img"
           aria-label="Balance at the end of each month">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks(max).map((t) => {
          const y = yOf(t);
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--grid)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y + 3} textAnchor="end" className="tnum"
                    fill="var(--muted)" fontSize="10">
                {t === 0 ? '0' : `$${Math.round(t / 100).toLocaleString()}`}
              </text>
            </g>
          );
        })}

        {points.length > 1 ? <path d={area} fill={`url(#${gradientId})`} /> : null}
        {points.length > 1 ? (
          <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
        ) : null}

        {points.map((p, i) => (
          <g key={p.period}>
            {/* 2px surface ring keeps the marker legible where it crosses the line. */}
            <circle cx={xOf(i)} cy={yOf(p.cents)} r="4.5"
                    fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />
            {i % labelEvery === 0 || i === points.length - 1 ? (
              <text x={xOf(i)} y={height - 8} textAnchor="middle" fill="var(--muted)" fontSize="10">
                {shortMonth(p.period)}
              </text>
            ) : null}
          </g>
        ))}

        {/* Direct-label the endpoint only — a number on every point goes unread. */}
        {points.length > 0 ? (
          <text x={xOf(points.length - 1)} y={yOf(points[points.length - 1]!.cents) - 12}
                textAnchor="end" className="tnum" fill="var(--text)" fontSize="11" fontWeight="600">
            {formatCents(points[points.length - 1]!.cents)}
          </text>
        ) : null}

        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH}
              stroke="var(--axis)" strokeWidth="1" />
      </svg>

      <HitLayer
        targets={points.map((p, i) => ({
          key: p.period,
          left: Math.max(0, xOf(i) - 18),
          width: 36,
          top: PAD.top,
          height: plotH,
          label: `${fullMonth(p.period)}: balance ${formatCents(p.cents)}`,
          onEnter: () => show((xOf(i) / W) * 100, yOf(p.cents), pointReadout(p)),
          onLeave: hide,
        }))}
      />
      <Tooltip tip={tip} />
    </div>
  );
}
