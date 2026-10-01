import { describe, expect, it } from 'vitest';
import { defaultFirstPeriod, paymentDate, paymentSchedule, paymentsDue } from '@budjo/shared';
import { needsMaintenance } from '../src/services/maintenance';

const terms = { totalCents: 100_000, months: 12, dayOfMonth: 15, firstPeriod: '2026-10' };

describe('paymentSchedule', () => {
  it('makes one payment a month on the chosen day', () => {
    const schedule = paymentSchedule(terms);
    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toMatchObject({ no: 1, date: '2026-10-15', period: '2026-10' });
    expect(schedule[11]).toMatchObject({ no: 12, date: '2027-09-15', period: '2027-09' });
  });

  it('always adds up to exactly the total', () => {
    for (const [totalCents, months] of [[100_000, 12], [99_999, 7], [1_000, 3], [12, 12], [50_000, 1]] as const) {
      const sum = paymentSchedule({ ...terms, totalCents, months }).reduce((t, p) => t + p.amountCents, 0);
      expect(sum).toBe(totalCents);
    }
  });

  it('puts the rounding remainder on the last payment', () => {
    const schedule = paymentSchedule(terms);
    expect(schedule[0]!.amountCents).toBe(8_333);
    expect(schedule[11]!.amountCents).toBe(8_337);
  });

  it('treats the 31st as the last day of a shorter month', () => {
    expect(paymentDate('2027-02', 31)).toBe('2027-02-28');
    expect(paymentDate('2028-02', 31)).toBe('2028-02-29');
    expect(paymentDate('2026-11', 31)).toBe('2026-11-30');
    expect(paymentDate('2026-12', 31)).toBe('2026-12-31');
  });
});

describe('paymentsDue', () => {
  it('charges nothing before the first day arrives', () => {
    expect(paymentsDue(terms, new Set(), '2026-10-14')).toHaveLength(0);
  });

  it('charges on the day itself', () => {
    expect(paymentsDue(terms, new Set(), '2026-10-15').map((p) => p.no)).toEqual([1]);
  });

  it('catches up on every payment that was missed', () => {
    expect(paymentsDue(terms, new Set([1]), '2027-01-20').map((p) => p.no)).toEqual([2, 3, 4]);
  });

  it('never charges past the end of the plan', () => {
    expect(paymentsDue(terms, new Set(), '2030-01-01')).toHaveLength(12);
  });
});

describe('defaultFirstPeriod', () => {
  it('starts this month when the day is still to come', () => {
    expect(defaultFirstPeriod('2026-09-10', 15)).toBe('2026-09');
  });
  it('starts this month when the day is today', () => {
    expect(defaultFirstPeriod('2026-09-15', 15)).toBe('2026-09');
  });
  it('starts next month when the day has passed', () => {
    expect(defaultFirstPeriod('2026-12-20', 15)).toBe('2027-01');
  });
  it('counts the 31st as today on the last day of a short month', () => {
    expect(defaultFirstPeriod('2026-09-30', 31)).toBe('2026-09');
  });
});

describe('needsMaintenance', () => {
  const PACIFIC = 'America/Los_Angeles';

  it('runs when it has never run', () => {
    expect(needsMaintenance(null, PACIFIC)).toBe(true);
  });

  // 06:00 UTC on Oct 1 is still Sep 30 in California. The morning of Oct 1
  // there is the same UTC day, and is exactly when the month's work is due.
  it('runs again on a new local day even within the same UTC day', () => {
    expect(needsMaintenance('2026-10-01T06:00:00.000Z', PACIFIC, new Date('2026-10-01T15:00:00.000Z'))).toBe(true);
  });

  it('does not run twice in one local day', () => {
    expect(needsMaintenance('2026-10-01T15:00:00.000Z', PACIFIC, new Date('2026-10-02T03:00:00.000Z'))).toBe(false);
  });
});
