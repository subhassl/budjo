import { describe, expect, it } from 'vitest';
import { decide, isOverdrawnSettlement } from '../src/domain/decision';

const RESERVE = 5000; // $50

const check = (amountCents: number, balanceCents: number, holdCents = 0) =>
  decide({ amountCents, balanceCents, holdCents, reserveThresholdCents: RESERVE });

describe('decide', () => {
  it('approves when plenty is left over', () => {
    const r = check(2000, 30000);
    expect(r.decision).toBe('approved');
    expect(r.availableCents).toBe(30000);
    expect(r.remainingCents).toBe(28000);
    expect(r.shortfallCents).toBe(0);
  });

  it('warns rather than blocking when the purchase leaves less than the reserve', () => {
    const r = check(9000, 12000);
    expect(r.decision).toBe('tight');
    expect(r.remainingCents).toBe(3000);
  });

  it('treats exactly the reserve as approved, and a cent under as tight', () => {
    expect(check(7000, 12000).decision).toBe('approved'); // leaves exactly $50
    expect(check(7001, 12000).decision).toBe('tight');
  });

  it('denies when the amount exceeds what is available', () => {
    const r = check(15000, 12000);
    expect(r.decision).toBe('denied');
    expect(r.shortfallCents).toBe(3000);
  });

  it('allows spending the balance down to exactly zero', () => {
    const r = check(12000, 12000);
    expect(r.decision).toBe('tight');
    expect(r.remainingCents).toBe(0);
    expect(r.shortfallCents).toBe(0);
  });

  it('denies a single cent over the balance', () => {
    const r = check(12001, 12000);
    expect(r.decision).toBe('denied');
    expect(r.shortfallCents).toBe(1);
  });

  // Holds are the reason two checks minutes apart cannot both be approved
  // against the same dollars — the joint account is genuinely concurrent.
  it('counts pending holds against what is available', () => {
    expect(check(9000, 12000, 0).decision).toBe('tight');
    expect(check(9000, 12000, 5000).decision).toBe('denied');
  });

  it('denies everything once holds have consumed the balance', () => {
    const r = check(100, 12000, 12000);
    expect(r.decision).toBe('denied');
    expect(r.availableCents).toBe(0);
  });

  it('denies from an already-negative balance', () => {
    const r = check(500, -2000);
    expect(r.decision).toBe('denied');
    expect(r.shortfallCents).toBe(2500);
  });

  it('never warns when the family has turned the reserve off', () => {
    const r = decide({ amountCents: 12000, balanceCents: 12000, holdCents: 0, reserveThresholdCents: 0 });
    expect(r.decision).toBe('approved');
  });

  it('carries a saved-up balance forward into the decision', () => {
    // $300 carried in + $200 allocated - $142.80 spent = $357.20 available.
    const balance = 30000 + 20000 - 14280;
    expect(check(35000, balance).decision).toBe('tight');
    expect(check(36000, balance).decision).toBe('denied');
  });
});

describe('isOverdrawnSettlement', () => {
  it('flags a settlement above what was available', () => {
    expect(isOverdrawnSettlement(9500, 8000)).toBe(true);
  });

  it('does not flag settling exactly the available amount', () => {
    expect(isOverdrawnSettlement(8000, 8000)).toBe(false);
  });

  it('does not flag the ordinary case of settling under the estimate', () => {
    expect(isOverdrawnSettlement(7500, 8000)).toBe(false);
  });
});
