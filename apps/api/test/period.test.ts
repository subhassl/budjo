import { describe, expect, it } from 'vitest';
import { formatPeriod, isPeriod, nextPeriod, periodOf, periodRange, prevPeriod } from '@budjo/shared';

const CHICAGO = 'America/Chicago';

describe('periodOf', () => {
  it('uses the family timezone, not UTC', () => {
    // 1 Sep 02:30 UTC is still 31 Aug in Chicago — the allocation belongs to August.
    expect(periodOf(new Date('2026-09-01T02:30:00Z'), CHICAGO)).toBe('2026-08');
    expect(periodOf(new Date('2026-09-01T02:30:00Z'), 'UTC')).toBe('2026-09');
  });

  it('rolls over at local midnight on the 1st', () => {
    expect(periodOf(new Date('2026-09-01T05:00:00Z'), CHICAGO)).toBe('2026-09');
  });

  it('is stable across a DST transition', () => {
    expect(periodOf(new Date('2026-03-08T08:00:00Z'), CHICAGO)).toBe('2026-03');
    expect(periodOf(new Date('2026-11-01T07:00:00Z'), CHICAGO)).toBe('2026-11');
  });

  it('handles a timezone ahead of UTC', () => {
    expect(periodOf(new Date('2026-08-31T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-09');
  });
});

describe('period arithmetic', () => {
  it('rolls the year over in both directions', () => {
    expect(nextPeriod('2026-12')).toBe('2027-01');
    expect(prevPeriod('2026-01')).toBe('2025-12');
  });

  it('builds an inclusive range', () => {
    expect(periodRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('returns an empty range when the end precedes the start', () => {
    expect(periodRange('2026-05', '2026-04')).toEqual([]);
  });

  it('caps a runaway range', () => {
    expect(periodRange('2000-01', '2099-12', 12)).toHaveLength(12);
  });

  it('validates the format', () => {
    expect(isPeriod('2026-09')).toBe(true);
    expect(isPeriod('2026-13')).toBe(false);
    expect(isPeriod('2026-9')).toBe(false);
    expect(() => nextPeriod('nonsense')).toThrow();
  });

  it('formats for display', () => {
    expect(formatPeriod('2026-09')).toBe('September 2026');
  });
});
