import { describe, expect, it } from 'vitest';
import {
  dateOf, formatPeriod, isCalendarDate, isPeriod, nextPeriod, occurredAtFor,
  periodFromDate, periodOf, periodRange, prevPeriod,
} from '@budjo/shared';

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

describe('backdating a spend', () => {
  it('reads the calendar date in the family timezone', () => {
    expect(dateOf(new Date('2026-09-01T02:30:00Z'), CHICAGO)).toBe('2026-08-31');
    expect(dateOf(new Date('2026-09-01T02:30:00Z'), 'UTC')).toBe('2026-09-01');
  });

  // The month comes straight off the date the user picked, not from converting
  // it through a timezone — they chose a calendar date in their own frame.
  it('puts the entry in the month it happened', () => {
    expect(periodFromDate('2026-08-31')).toBe('2026-08');
    expect(periodFromDate('2026-09-01')).toBe('2026-09');
  });

  it('keeps the real time for today, so same-day entries stay in order', () => {
    const now = new Date('2026-09-07T18:30:00Z');
    expect(occurredAtFor(dateOf(now, CHICAGO), CHICAGO, now)).toBe(now.toISOString());
  });

  it('uses midday for a past date, so it cannot render as the day before', () => {
    const now = new Date('2026-09-07T18:30:00Z');
    expect(occurredAtFor('2026-09-02', CHICAGO, now)).toBe('2026-09-02T12:00:00.000Z');
    // History groups on the first 10 characters, so that must still be the date.
    expect(occurredAtFor('2026-09-02', CHICAGO, now).slice(0, 10)).toBe('2026-09-02');
  });

  it('rejects dates that are not real', () => {
    expect(isCalendarDate('2026-09-07')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-9-7')).toBe(false);
    expect(isCalendarDate('yesterday')).toBe(false);
  });

  it('orders string dates correctly, which is how the future check works', () => {
    expect('2026-09-08' > '2026-09-07').toBe(true);
    expect('2026-10-01' > '2026-09-30').toBe(true);
    expect('2027-01-01' > '2026-12-31').toBe(true);
  });
});
