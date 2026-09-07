import { describe, expect, it } from 'vitest';
import type { LedgerType } from '@budjo/shared';
import { canEditType, canVoidType, isValidAmountForType, whyNotEditable } from '../src/domain/ledgerEdits';

describe('what an admin may correct by hand', () => {
  it('allows the entries that stand alone', () => {
    for (const type of ['spend', 'refund', 'adjustment'] as LedgerType[]) {
      expect(canEditType(type)).toBe(true);
    }
  });

  // Rewriting one leg would leave the two accounts disagreeing about the same
  // movement of money.
  it('refuses a transfer, which has two sides', () => {
    expect(canEditType('transfer_in')).toBe(false);
    expect(canEditType('transfer_out')).toBe(false);
    expect(canVoidType('transfer_out')).toBe(false);
    expect(whyNotEditable('transfer_out')).toMatch(/two sides/);
  });

  // The entry is bound to a row in `advances` that the monthly job reads;
  // editing the entry would not touch the schedule.
  it('refuses advances, which the monthly job settles', () => {
    expect(canEditType('advance')).toBe(false);
    expect(canEditType('advance_repayment')).toBe(false);
    expect(whyNotEditable('advance')).toMatch(/monthly job/);
  });

  it('refuses allocations, which are corrected by changing the amount', () => {
    expect(canEditType('allocation')).toBe(false);
    expect(whyNotEditable('allocation')).toMatch(/Accounts/);
  });

  it('allows voiding an allocation even though it cannot be edited', () => {
    expect(canVoidType('allocation')).toBe(true);
  });

  it('refuses to edit a correction', () => {
    expect(canEditType('void')).toBe(false);
    expect(canVoidType('void')).toBe(false);
  });
});

describe('amount must match the kind of entry', () => {
  // A typo must not turn a $60 dinner into a $60 credit.
  it('keeps a spend negative', () => {
    expect(isValidAmountForType('spend', -6000)).toBe(true);
    expect(isValidAmountForType('spend', 6000)).toBe(false);
  });

  it('keeps a refund positive', () => {
    expect(isValidAmountForType('refund', 6000)).toBe(true);
    expect(isValidAmountForType('refund', -6000)).toBe(false);
  });

  it('lets an adjustment go either way', () => {
    expect(isValidAmountForType('adjustment', 500)).toBe(true);
    expect(isValidAmountForType('adjustment', -500)).toBe(true);
  });

  it('rejects zero and fractional cents', () => {
    expect(isValidAmountForType('spend', 0)).toBe(false);
    expect(isValidAmountForType('adjustment', 0)).toBe(false);
    expect(isValidAmountForType('spend', -10.5)).toBe(false);
  });
});
