import { comparePeriods, nextPeriod, periodRange, type Period } from '@budjo/shared';

export interface AllocationRule {
  amountCents: number;
  effectiveFrom: Period;
  effectiveTo: Period | null;
}

export interface PlannedAllocation {
  period: Period;
  amountCents: number;
}

export interface OpenAdvance {
  id: string;
  amountCents: number;
  repayPeriod: Period;
}

/** How much this account is allocated in `period`, or null if nothing applies. */
export function amountForPeriod(rules: readonly AllocationRule[], period: Period): number | null {
  let best: AllocationRule | undefined;
  for (const rule of rules) {
    if (comparePeriods(rule.effectiveFrom, period) > 0) continue;
    if (rule.effectiveTo && comparePeriods(period, rule.effectiveTo) > 0) continue;
    if (!best || comparePeriods(rule.effectiveFrom, best.effectiveFrom) > 0) best = rule;
  }
  return best ? best.amountCents : null;
}

/**
 * Which allocations are missing and need posting, given what's already there.
 *
 * Backfills gaps (the app was down for two months) but never invents history
 * before an account's first rule — so adding a child in September doesn't hand
 * them eight months of retroactive allowance.
 */
export function planAllocations(input: {
  rules: readonly AllocationRule[];
  lastAllocatedPeriod: Period | null;
  currentPeriod: Period;
  maxMonths?: number;
}): PlannedAllocation[] {
  const { rules, lastAllocatedPeriod, currentPeriod, maxMonths = 120 } = input;
  if (rules.length === 0) return [];

  const earliest = rules.reduce(
    (min, r) => (comparePeriods(r.effectiveFrom, min) < 0 ? r.effectiveFrom : min),
    rules[0]!.effectiveFrom,
  );

  const start = lastAllocatedPeriod ? nextPeriod(lastAllocatedPeriod) : earliest;
  if (comparePeriods(start, currentPeriod) > 0) return [];

  const out: PlannedAllocation[] = [];
  for (const period of periodRange(start, currentPeriod, maxMonths)) {
    if (comparePeriods(period, earliest) < 0) continue;
    const amountCents = amountForPeriod(rules, period);
    if (amountCents !== null && amountCents > 0) out.push({ period, amountCents });
  }
  return out;
}

/** Advances whose repayment month has arrived and which haven't been repaid. */
export function advancesDue(
  advances: readonly OpenAdvance[],
  currentPeriod: Period,
): OpenAdvance[] {
  return advances.filter((a) => comparePeriods(a.repayPeriod, currentPeriod) <= 0);
}

/**
 * What next month opens at, shown on the home screen so an advance is visible
 * as a consequence rather than a surprise.
 */
export function nextPeriodOpening(input: {
  balanceCents: number;
  nextAllocationCents: number;
  outstandingAdvanceCents: number;
}): number {
  return input.balanceCents + input.nextAllocationCents - input.outstandingAdvanceCents;
}

/**
 * The cap on borrowing forward: whatever the admin set for the account, or one
 * month's allocation if they left it unset.
 */
export function advanceLimitCents(input: {
  maxAdvanceCents: number | null;
  monthlyAllocationCents: number;
  alreadyOutstandingCents: number;
}): number {
  const cap = input.maxAdvanceCents ?? input.monthlyAllocationCents;
  return Math.max(0, cap - input.alreadyOutstandingCents);
}
