/**
 * A "period" is a calendar month in the family's timezone, as 'YYYY-MM'.
 * Allocations, snapshots and advance repayments are all keyed by it.
 */

export type Period = string;

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: string): value is Period {
  return PERIOD_RE.test(value);
}

/** The period containing `now`, evaluated in `timeZone`. */
export function periodOf(now: Date, timeZone: string): Period {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  return `${year}-${month}`;
}

export function nextPeriod(period: Period): Period {
  const [y, m] = splitPeriod(period);
  return m === 12 ? fmt(y + 1, 1) : fmt(y, m + 1);
}

export function prevPeriod(period: Period): Period {
  const [y, m] = splitPeriod(period);
  return m === 1 ? fmt(y - 1, 12) : fmt(y, m - 1);
}

export function comparePeriods(a: Period, b: Period): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive list of periods from `from` to `to`. Empty if from > to. */
export function periodRange(from: Period, to: Period, limit = 600): Period[] {
  const out: Period[] = [];
  let cur = from;
  while (comparePeriods(cur, to) <= 0) {
    out.push(cur);
    if (out.length >= limit) break;
    cur = nextPeriod(cur);
  }
  return out;
}

export function formatPeriod(period: Period): string {
  const [y, m] = splitPeriod(period);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function splitPeriod(period: Period): [number, number] {
  if (!isPeriod(period)) throw new Error(`Invalid period: ${period}`);
  return [Number(period.slice(0, 4)), Number(period.slice(5, 7))];
}

function fmt(y: number, m: number): Period {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}
