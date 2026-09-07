import { describe, expect, it } from 'vitest';
import type { LedgerType } from '@budjo/shared';
import {
  canEditType, canVoidType, editModeFor, editWindowClosesAt, isValidAmountForType,
  isWithinEditWindow, whyNotEditable,
} from '../src/domain/ledgerEdits';

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

describe('the edit window', () => {
  const NOW = new Date('2026-09-07T12:00:00Z');
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

  it('is open just inside the window and shut just outside', () => {
    expect(isWithinEditWindow(hoursAgo(47.9), 48, NOW)).toBe(true);
    expect(isWithinEditWindow(hoursAgo(48.1), 48, NOW)).toBe(false);
  });

  it('treats the exact boundary as closed', () => {
    expect(isWithinEditWindow(hoursAgo(48), 48, NOW)).toBe(false);
  });

  it('edits in place while fresh, and corrects once old', () => {
    const entry = (h: number) => ({ type: 'spend' as const, createdAt: hoursAgo(h), alreadyCorrected: false });
    expect(editModeFor(entry(2), { editWindowHours: 48, now: NOW })).toBe('direct');
    expect(editModeFor(entry(72), { editWindowHours: 48, now: NOW })).toBe('correction');
  });

  it('honours a shortened or lengthened window', () => {
    const entry = { type: 'spend' as const, createdAt: hoursAgo(6), alreadyCorrected: false };
    expect(editModeFor(entry, { editWindowHours: 1, now: NOW })).toBe('correction');
    expect(editModeFor(entry, { editWindowHours: 168, now: NOW })).toBe('direct');
  });

  it('forces corrections when the window is set to zero', () => {
    const entry = { type: 'spend' as const, createdAt: NOW.toISOString(), alreadyCorrected: false };
    expect(editModeFor(entry, { editWindowHours: 0, now: NOW })).toBe('correction');
  });

  // Editing in place would leave the correction describing a change that no
  // longer matches what it reversed.
  it('blocks an entry something already points at, however fresh', () => {
    expect(editModeFor(
      { type: 'spend', createdAt: hoursAgo(1), alreadyCorrected: true },
      { editWindowHours: 48, now: NOW },
    )).toBe('blocked');
  });

  it('still blocks types that are never hand-editable, however fresh', () => {
    expect(editModeFor(
      { type: 'transfer_out', createdAt: hoursAgo(1), alreadyCorrected: false },
      { editWindowHours: 48, now: NOW },
    )).toBe('blocked');
  });

  // The window runs from creation, so backdating a spend to last month does not
  // put it out of reach, and dating one today does not reopen an old row.
  it('measures from creation, not the date the entry carries', () => {
    expect(isWithinEditWindow(hoursAgo(1), 48, NOW)).toBe(true);
    expect(editWindowClosesAt(hoursAgo(1), 48)).toBe('2026-09-09T11:00:00.000Z');
  });

  it('refuses a malformed timestamp rather than treating it as fresh', () => {
    expect(isWithinEditWindow('not-a-date', 48, NOW)).toBe(false);
  });
});
