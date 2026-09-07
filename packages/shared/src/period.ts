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

/** Calendar date as 'YYYY-MM-DD' in a given timezone. */
export function dateOf(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * The period a backdated entry belongs to. Taken straight from the date the
 * user picked rather than converted through a timezone: they chose a calendar
 * date in their own frame, and a spend on the 31st belongs to that month
 * whatever the clock says. The running balance is unaffected either way — only
 * which month's "spent" total it lands in.
 */
export function periodFromDate(date: string): Period {
  return date.slice(0, 7);
}

/**
 * When the entry happened. For today we keep the real time so entries stay in
 * order within the day; for a past date, midday avoids any chance of the
 * timestamp rendering as the neighbouring day.
 */
export function occurredAtFor(date: string, timeZone: string, now = new Date()): string {
  return date === dateOf(now, timeZone) ? now.toISOString() : `${date}T12:00:00.000Z`;
}
