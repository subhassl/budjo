import { describe, expect, it } from 'vitest';
import {
  advanceLimitCents, advancesDue, amountForPeriod, nextPeriodOpening, planAllocations,
  type AllocationRule,
} from '../src/domain/allocation';

const rule = (effectiveFrom: string, amountCents: number, effectiveTo: string | null = null): AllocationRule =>
  ({ effectiveFrom, amountCents, effectiveTo });

describe('amountForPeriod', () => {
  const rules = [rule('2026-01', 20000), rule('2026-06', 25000)];

  it('uses the rule in force for that month', () => {
    expect(amountForPeriod(rules, '2026-03')).toBe(20000);
    expect(amountForPeriod(rules, '2026-06')).toBe(25000);
    expect(amountForPeriod(rules, '2026-09')).toBe(25000);
  });

  it('returns null before any rule exists, rather than assuming zero', () => {
    expect(amountForPeriod(rules, '2025-12')).toBeNull();
  });

  it('respects an explicitly closed rule', () => {
    expect(amountForPeriod([rule('2026-01', 20000, '2026-03')], '2026-04')).toBeNull();
  });

  it('is order-independent', () => {
    expect(amountForPeriod([rule('2026-06', 25000), rule('2026-01', 20000)], '2026-07')).toBe(25000);
  });
});

describe('planAllocations', () => {
  const rules = [rule('2026-01', 20000)];

  it('posts the current month when nothing has been allocated yet', () => {
    expect(planAllocations({ rules, lastAllocatedPeriod: '2026-08', currentPeriod: '2026-09' }))
      .toEqual([{ period: '2026-09', amountCents: 20000 }]);
  });

  it('is a no-op once the current month is already allocated', () => {
    expect(planAllocations({ rules, lastAllocatedPeriod: '2026-09', currentPeriod: '2026-09' })).toEqual([]);
  });

  // The app being down for two months must not cost anyone their allowance.
  it('backfills months that were missed', () => {
    const planned = planAllocations({ rules, lastAllocatedPeriod: '2026-06', currentPeriod: '2026-09' });
    expect(planned.map((p) => p.period)).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('backfills across a year boundary', () => {
    const planned = planAllocations({
      rules: [rule('2025-01', 20000)],
      lastAllocatedPeriod: '2025-11',
      currentPeriod: '2026-02',
    });
    expect(planned.map((p) => p.period)).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('applies the amount in force for each backfilled month, not today’s amount', () => {
    const planned = planAllocations({
      rules: [rule('2026-01', 20000), rule('2026-09', 30000)],
      lastAllocatedPeriod: '2026-07',
      currentPeriod: '2026-09',
    });
    expect(planned).toEqual([
      { period: '2026-08', amountCents: 20000 },
      { period: '2026-09', amountCents: 30000 },
    ]);
  });

  // Adding a child in September must not hand them eight months of allowance.
  it('never invents history before the account’s first rule', () => {
    const planned = planAllocations({
      rules: [rule('2026-09', 5000)],
      lastAllocatedPeriod: null,
      currentPeriod: '2026-09',
    });
    expect(planned).toEqual([{ period: '2026-09', amountCents: 5000 }]);
  });

  it('does nothing for an account with no allocation rule at all', () => {
    expect(planAllocations({ rules: [], lastAllocatedPeriod: null, currentPeriod: '2026-09' })).toEqual([]);
  });

  it('skips months whose allocation is zero', () => {
    const planned = planAllocations({
      rules: [rule('2026-01', 20000), rule('2026-08', 0), rule('2026-09', 20000)],
      lastAllocatedPeriod: '2026-07',
      currentPeriod: '2026-09',
    });
    expect(planned.map((p) => p.period)).toEqual(['2026-09']);
  });

  it('ignores a last-allocated period ahead of today (clock skew)', () => {
    expect(planAllocations({ rules, lastAllocatedPeriod: '2026-12', currentPeriod: '2026-09' })).toEqual([]);
  });
});

describe('advancesDue', () => {
  const advances = [
    { id: 'a1', amountCents: 5000, repayPeriod: '2026-09' },
    { id: 'a2', amountCents: 2000, repayPeriod: '2026-10' },
  ];

  it('repays only advances whose month has arrived', () => {
    expect(advancesDue(advances, '2026-09').map((a) => a.id)).toEqual(['a1']);
    expect(advancesDue(advances, '2026-10').map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('still repays an advance the job missed last month', () => {
    expect(advancesDue([{ id: 'old', amountCents: 100, repayPeriod: '2026-05' }], '2026-09')).toHaveLength(1);
  });
});

describe('advanceLimitCents', () => {
  it('defaults the cap to one month’s allocation', () => {
    expect(advanceLimitCents({ maxAdvanceCents: null, monthlyAllocationCents: 20000, alreadyOutstandingCents: 0 }))
      .toBe(20000);
  });

  it('honours an admin-set cap over the default', () => {
    expect(advanceLimitCents({ maxAdvanceCents: 5000, monthlyAllocationCents: 20000, alreadyOutstandingCents: 0 }))
      .toBe(5000);
  });

  it('counts what is already borrowed against the cap', () => {
    expect(advanceLimitCents({ maxAdvanceCents: 5000, monthlyAllocationCents: 20000, alreadyOutstandingCents: 3000 }))
      .toBe(2000);
  });

  it('never goes negative when the cap is lowered below what is outstanding', () => {
    expect(advanceLimitCents({ maxAdvanceCents: 1000, monthlyAllocationCents: 20000, alreadyOutstandingCents: 3000 }))
      .toBe(0);
  });

  it('blocks borrowing entirely when the cap is zero', () => {
    expect(advanceLimitCents({ maxAdvanceCents: 0, monthlyAllocationCents: 20000, alreadyOutstandingCents: 0 }))
      .toBe(0);
  });
});

describe('nextPeriodOpening', () => {
  it('shows an advance as a smaller opening balance next month', () => {
    expect(nextPeriodOpening({ balanceCents: 8000, nextAllocationCents: 20000, outstandingAdvanceCents: 5000 }))
      .toBe(23000);
  });

  it('can open negative when the advance exceeds the allocation', () => {
    expect(nextPeriodOpening({ balanceCents: 0, nextAllocationCents: 20000, outstandingAdvanceCents: 25000 }))
      .toBe(-5000);
  });
});
