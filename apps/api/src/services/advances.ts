import { nextPeriod, periodOf, type FamilySettings } from '@budjo/shared';
import { advanceLimitCents, amountForPeriod } from '../domain/allocation';
import { getAllocationRules, getOpenAdvances } from '../db/repo';
import type { Account } from '@budjo/shared';
import { ledgerInsert } from './ledger';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';
import { conflict } from '../lib/http';

/**
 * Borrow against next month's allocation. The cap is whatever the admin set on
 * the account, or one month's allocation if they left it unset; kids' accounts
 * ship with advances turned off entirely.
 *
 * The repayment is not scheduled work — it's a row in `advances` that the
 * monthly maintenance pass turns into a negative ledger entry when its period
 * arrives, guarded by a unique index so it can only ever be repaid once.
 */
export async function takeAdvance(
  db: D1Database,
  actorUserId: string,
  family: FamilySettings,
  account: Account,
  amountCents: number,
  now = new Date(),
): Promise<{ advanceId: string; repayPeriod: string; remainingHeadroomCents: number }> {
  const iso = nowIso(now);
  const period = periodOf(now, family.timezone);
  const repayPeriod = nextPeriod(period);

  const [rulesByAccount, advancesByAccount] = await Promise.all([
    getAllocationRules(db, account.id),
    getOpenAdvances(db, account.id),
  ]);

  const monthly = amountForPeriod(rulesByAccount.get(account.id) ?? [], repayPeriod)
    ?? amountForPeriod(rulesByAccount.get(account.id) ?? [], period)
    ?? 0;
  const outstanding = (advancesByAccount.get(account.id) ?? []).reduce((s, a) => s + a.amountCents, 0);
  const headroom = advanceLimitCents({
    maxAdvanceCents: account.maxAdvanceCents,
    monthlyAllocationCents: monthly,
    alreadyOutstandingCents: outstanding,
  });

  if (amountCents > headroom) {
    throw conflict(
      headroom === 0
        ? 'You have already borrowed as much as this account allows'
        : `You can borrow at most ${(headroom / 100).toFixed(2)} right now`,
    );
  }

  const advanceId = newId('adv');
  await db.batch([
    db.prepare(
      `INSERT INTO advances (id, account_id, amount_cents, repay_period, created_by, created_at)
       VALUES (?,?,?,?,?,?)`,
    ).bind(advanceId, account.id, amountCents, repayPeriod, actorUserId, iso),
    ledgerInsert(db, {
      accountId: account.id,
      actorUserId,
      type: 'advance',
      amountCents,
      period,
      advanceId,
      note: `Advance against ${repayPeriod}`,
      occurredAt: iso,
      createdBy: actorUserId,
    }),
  ]);

  return { advanceId, repayPeriod, remainingHeadroomCents: headroom - amountCents };
}
