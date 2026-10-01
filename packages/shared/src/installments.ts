import { nextPeriod, type Period } from './period';

/**
 * The arithmetic of a payment plan. Pure, and shared, so the form can preview
 * exactly the schedule the server will post.
 */

export interface PlanTerms {
  totalCents: number;
  months: number;
  dayOfMonth: number;
  firstPeriod: Period;
}

export interface ScheduledPayment {
  /** 1-based. */
  no: number;
  /** 'YYYY-MM-DD' */
  date: string;
  period: Period;
  amountCents: number;
}

const daysIn = (period: Period) =>
  new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();

/**
 * The day a payment falls on in a given month. A plan on the 31st means "the
 * last day" in shorter months — otherwise it would skip February entirely.
 */
export function paymentDate(period: Period, dayOfMonth: number): string {
  const day = Math.min(dayOfMonth, daysIn(period));
  return `${period}-${String(day).padStart(2, '0')}`;
}

/**
 * Equal payments, rounded down to the cent, with the last one absorbing the
 * remainder so the payments always add up to exactly the total.
 */
export function paymentSchedule(terms: PlanTerms): ScheduledPayment[] {
  const base = Math.floor(terms.totalCents / terms.months);
  const out: ScheduledPayment[] = [];
  let period = terms.firstPeriod;
  for (let no = 1; no <= terms.months; no++) {
    out.push({
      no,
      date: paymentDate(period, terms.dayOfMonth),
      period,
      amountCents: no === terms.months ? terms.totalCents - base * (terms.months - 1) : base,
    });
    period = nextPeriod(period);
  }
  return out;
}

/** Payments whose day has arrived and which have not been posted yet. */
export function paymentsDue(
  terms: PlanTerms,
  postedNos: ReadonlySet<number>,
  today: string,
): ScheduledPayment[] {
  return paymentSchedule(terms).filter((p) => p.date <= today && !postedNos.has(p.no));
}

/**
 * Which month a new plan starts in when the user does not say: this month if
 * its day is still to come (or is today), otherwise next month.
 */
export function defaultFirstPeriod(today: string, dayOfMonth: number): Period {
  const period = today.slice(0, 7);
  return paymentDate(period, dayOfMonth) >= today ? period : nextPeriod(period);
}

export type PlanStatus = 'active' | 'completed' | 'cancelled';

export interface InstallmentPayment extends ScheduledPayment {
  posted: boolean;
}

export interface InstallmentPlan {
  id: string;
  accountId: string;
  description: string;
  totalCents: number;
  months: number;
  dayOfMonth: number;
  firstPeriod: Period;
  categoryId: string | null;
  cardId: string | null;
  createdBy: string | null;
  createdAt: string;
  cancelledAt: string | null;
  status: PlanStatus;
  /** The regular monthly payment; the last one may differ by a few cents. */
  monthlyCents: number;
  paidCount: number;
  paidCents: number;
  /** Still to be charged. Zero once completed or cancelled. */
  remainingCents: number;
  remainingCount: number;
  next: ScheduledPayment | null;
  payments: InstallmentPayment[];
  canManage: boolean;
}
