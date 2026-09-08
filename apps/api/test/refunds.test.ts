import { describe, expect, it } from 'vitest';
import {
  blocksEditing, checkRefund, refundRejectionMessage, refundableCents,
} from '../src/domain/refunds';

// A $60 dinner, as stored: spends are negative.
const purchase = (over: Partial<Parameters<typeof checkRefund>[0]> = {}) => ({
  type: 'spend' as const,
  amountCents: -6000,
  voided: false,
  alreadyRefundedCents: 0,
  ...over,
});

describe('refundableCents', () => {
  it('starts at the full purchase price', () => {
    expect(refundableCents(purchase())).toBe(6000);
  });

  it('shrinks as money comes back', () => {
    expect(refundableCents(purchase({ alreadyRefundedCents: 2500 }))).toBe(3500);
  });

  it('is zero once fully returned', () => {
    expect(refundableCents(purchase({ alreadyRefundedCents: 6000 }))).toBe(0);
  });

  it('never goes negative', () => {
    expect(refundableCents(purchase({ alreadyRefundedCents: 9000 }))).toBe(0);
  });

  it('is zero for anything that is not a live purchase', () => {
    expect(refundableCents(purchase({ voided: true }))).toBe(0);
    expect(refundableCents(purchase({ type: 'allocation' }))).toBe(0);
    expect(refundableCents(purchase({ type: 'refund', amountCents: 2000 }))).toBe(0);
  });
});

describe('checkRefund', () => {
  it('accepts a full return', () => {
    expect(checkRefund(purchase(), 6000)).toBeNull();
  });

  it('accepts a partial return', () => {
    expect(checkRefund(purchase(), 2500)).toBeNull();
  });

  it('accepts a second return that fits in what is left', () => {
    expect(checkRefund(purchase({ alreadyRefundedCents: 2500 }), 3500)).toBeNull();
  });

  // Otherwise a return invents money and drives the month's spend negative.
  it('refuses more than was spent', () => {
    expect(checkRefund(purchase(), 6001)).toBe('exceeds_remaining');
  });

  it('refuses a second return that would overshoot', () => {
    expect(checkRefund(purchase({ alreadyRefundedCents: 4000 }), 2500)).toBe('exceeds_remaining');
  });

  it('refuses anything against a fully returned purchase', () => {
    expect(checkRefund(purchase({ alreadyRefundedCents: 6000 }), 1)).toBe('exceeds_remaining');
  });

  it('refuses zero, negative and fractional amounts', () => {
    expect(checkRefund(purchase(), 0)).toBe('not_positive');
    expect(checkRefund(purchase(), -100)).toBe('not_positive');
    expect(checkRefund(purchase(), 12.5)).toBe('not_positive');
  });

  it('refuses to return an entry that was removed', () => {
    expect(checkRefund(purchase({ voided: true }), 1000)).toBe('voided');
  });

  it('refuses to return anything that is not a purchase', () => {
    expect(checkRefund(purchase({ type: 'allocation', amountCents: 20000 }), 100)).toBe('not_a_spend');
    expect(checkRefund(purchase({ type: 'refund', amountCents: 1000 }), 100)).toBe('not_a_spend');
    expect(checkRefund(purchase({ type: 'transfer_in', amountCents: 1000 }), 100)).toBe('not_a_spend');
  });
});

describe('messages', () => {
  it('says how much is left when the amount is too big', () => {
    expect(refundRejectionMessage('exceeds_remaining', 3500)).toMatch('35.00');
  });

  it('says so plainly when nothing is left', () => {
    expect(refundRejectionMessage('exceeds_remaining', 0)).toMatch(/already been fully returned/);
  });
});

describe('blocksEditing', () => {
  // Refunds were sized against the original amount; changing it underneath
  // them could leave more returned than was ever spent.
  it('locks a purchase once money has come back on it', () => {
    expect(blocksEditing(1)).toBe(true);
    expect(blocksEditing(6000)).toBe(true);
  });

  it('leaves an untouched purchase editable', () => {
    expect(blocksEditing(0)).toBe(false);
  });
});
