import type { LedgerType } from '@budjo/shared';

/**
 * Returning something is not the same as correcting a mistake.
 *
 * A void says the entry should never have existed and reverses it whole. A
 * refund says the purchase happened and some of the money came back — it can
 * be partial, it happens on its own date, and both sides stay in history
 * because both are true.
 */

export interface RefundTarget {
  type: LedgerType;
  /** Signed as stored: a spend is negative. */
  amountCents: number;
  voided: boolean;
  alreadyRefundedCents: number;
}

export type RefundRejection =
  | 'not_a_spend'
  | 'voided'
  | 'not_positive'
  | 'exceeds_remaining';

/** What is still returnable on this purchase. Never negative. */
export function refundableCents(target: RefundTarget): number {
  if (target.type !== 'spend' || target.voided) return 0;
  return Math.max(0, Math.abs(target.amountCents) - target.alreadyRefundedCents);
}

export function checkRefund(
  target: RefundTarget,
  amountCents: number,
): RefundRejection | null {
  if (target.type !== 'spend') return 'not_a_spend';
  if (target.voided) return 'voided';
  if (!Number.isInteger(amountCents) || amountCents <= 0) return 'not_positive';
  // Getting more back than you paid is not a return; it would silently invent
  // money and leave the month's spend total negative.
  if (amountCents > refundableCents(target)) return 'exceeds_remaining';
  return null;
}

export function refundRejectionMessage(reason: RefundRejection, remainingCents: number): string {
  switch (reason) {
    case 'not_a_spend':
      return 'Only a purchase can be returned';
    case 'voided':
      return 'That entry was removed, so there is nothing to return';
    case 'not_positive':
      return 'Enter how much came back';
    case 'exceeds_remaining':
      return remainingCents === 0
        ? 'That purchase has already been fully returned'
        : `You can return at most ${(remainingCents / 100).toFixed(2)} on this purchase`;
  }
}

/**
 * A purchase with money already returned against it cannot be rewritten: the
 * refunds were sized against the original amount, and changing it underneath
 * them could leave more returned than was ever spent.
 */
export function blocksEditing(alreadyRefundedCents: number): boolean {
  return alreadyRefundedCents > 0;
}
