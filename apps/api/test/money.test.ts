import { describe, expect, it } from 'vitest';
import { formatCents, formatCentsShort, parseDollarsToCents } from '@budjo/shared';

describe('parseDollarsToCents', () => {
  it('parses what people actually type', () => {
    expect(parseDollarsToCents('12')).toBe(1200);
    expect(parseDollarsToCents('12.5')).toBe(1250);
    expect(parseDollarsToCents('12.50')).toBe(1250);
    expect(parseDollarsToCents('$1,234.56')).toBe(123456);
    expect(parseDollarsToCents('.99')).toBe(99);
  });

  it('rejects anything that is not a clean amount', () => {
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('-5')).toBeNull();
    expect(parseDollarsToCents('1.234')).toBeNull();
  });

  // Cents are integers everywhere; floats never enter the system.
  it('does not lose a cent to floating point', () => {
    expect(parseDollarsToCents('0.07')).toBe(7);
    expect(parseDollarsToCents('1.10')).toBe(110);
    expect(parseDollarsToCents('19.99')).toBe(1999);
  });
});

describe('formatCents', () => {
  it('formats positive, negative and zero', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-2000)).toBe('-$20.00');
    expect(formatCents(0)).toBe('$0.00');
  });

  it('can show an explicit plus for credits', () => {
    expect(formatCents(2000, { sign: true })).toBe('+$20.00');
  });

  it('drops trailing zero cents in the compact form', () => {
    expect(formatCentsShort(1200)).toBe('$12');
    expect(formatCentsShort(1250)).toBe('$12.50');
  });
});
