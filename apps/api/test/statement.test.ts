import { describe, expect, it } from 'vitest';
import { daysUntilDayOfMonth, describeDaysUntil } from '@budjo/shared';

const PACIFIC = 'America/Los_Angeles';
// Noon UTC keeps these on the intended Pacific day.
const on = (date: string) => new Date(`${date}T19:00:00.000Z`);

describe('daysUntilDayOfMonth', () => {
  it('counts forward within the month', () => {
    expect(daysUntilDayOfMonth(12, on('2026-09-07'), PACIFIC)).toBe(5);
  });

  it('is zero on the day itself', () => {
    expect(daysUntilDayOfMonth(7, on('2026-09-07'), PACIFIC)).toBe(0);
  });

  it('rolls into next month once the day has passed', () => {
    // 30 days in September: 30 - 20 + 5 = 15
    expect(daysUntilDayOfMonth(5, on('2026-09-20'), PACIFIC)).toBe(15);
  });

  it('rolls across a year boundary', () => {
    expect(daysUntilDayOfMonth(3, on('2026-12-30'), PACIFIC)).toBe(4);
  });

  // A card closing on the 31st must still fire in a short month rather than
  // waiting for one that has a 31st.
  it('treats a day past the end of the month as the last day', () => {
    expect(daysUntilDayOfMonth(31, on('2027-02-26'), PACIFIC)).toBe(2);
    expect(daysUntilDayOfMonth(30, on('2027-02-27'), PACIFIC)).toBe(1);
  });

  it('handles a leap February', () => {
    expect(daysUntilDayOfMonth(31, on('2028-02-27'), PACIFIC)).toBe(2);
  });

  it('reads the day in the family timezone, not UTC', () => {
    // 02:30Z on the 8th is still the 7th in California.
    expect(daysUntilDayOfMonth(10, new Date('2026-09-08T02:30:00Z'), PACIFIC)).toBe(3);
    expect(daysUntilDayOfMonth(10, new Date('2026-09-08T02:30:00Z'), 'UTC')).toBe(2);
  });
});

describe('describeDaysUntil', () => {
  it('reads naturally', () => {
    expect(describeDaysUntil(0)).toBe('today');
    expect(describeDaysUntil(1)).toBe('tomorrow');
    expect(describeDaysUntil(4)).toBe('in 4 days');
  });
});
