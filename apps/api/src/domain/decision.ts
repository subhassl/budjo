import type { Decision, DecisionResult } from '@budjo/shared';

export interface DecisionInput {
  /** What the user says they're about to spend. */
  amountCents: number;
  /** Sum of every ledger entry on the account, since the beginning of time. */
  balanceCents: number;
  /** Sum of estimates on pending, unexpired spend checks for this account. */
  holdCents: number;
  /** Below this remaining amount we warn rather than approve outright. */
  reserveThresholdCents: number;
}

/**
 * The whole decision engine. Deliberately pure: no clock, no database, no
 * account or user objects — just the four numbers that matter. Everything
 * about who may do this is decided in domain/access.ts before we get here.
 */
export function decide(input: DecisionInput): DecisionResult {
  const { amountCents, balanceCents, holdCents, reserveThresholdCents } = input;
  const availableCents = balanceCents - holdCents;
  const remainingCents = availableCents - amountCents;
  const shortfallCents = Math.max(0, -remainingCents);

  let decision: Decision;
  if (remainingCents < 0) {
    decision = 'denied';
  } else if (remainingCents < reserveThresholdCents) {
    decision = 'tight';
  } else {
    decision = 'approved';
  }

  return { decision, availableCents, remainingCents, shortfallCents };
}

/**
 * Settlement always succeeds, even when the actual amount exceeds what was
 * available — the money is already spent, and refusing to record it would only
 * make the ledger wrong. This just reports whether that happened, so the entry
 * can be flagged in history.
 *
 * `availableExcludingThisHold` must exclude the check being settled, otherwise
 * its own hold would be counted against it.
 */
export function isOverdrawnSettlement(
  actualCents: number,
  availableExcludingThisHold: number,
): boolean {
  return actualCents > availableExcludingThisHold;
}
