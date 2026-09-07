import { nextPeriod, periodOf, type AccountSummary, type FamilySettings } from '@budjo/shared';
import { amountForPeriod, nextPeriodOpening } from '../domain/allocation';
import { canSpendFromAccount, visibleAccounts, type AccessContext } from '../domain/access';
import { getAllocationRules, getBalances, getOpenAdvances, getPeriodTotals } from '../db/repo';
import { nowIso } from '../lib/time';

/**
 * Everything the home screen needs, for every account this user may see, in
 * five queries rather than five per account.
 */
export async function buildSummaries(
  db: D1Database,
  ctx: AccessContext,
  family: FamilySettings,
  now = new Date(),
): Promise<AccountSummary[]> {
  const iso = nowIso(now);
  const period = periodOf(now, family.timezone);
  const upcoming = nextPeriod(period);

  const [balances, totals, rules, advances] = await Promise.all([
    getBalances(db, iso),
    getPeriodTotals(db, period),
    getAllocationRules(db),
    getOpenAdvances(db),
  ]);

  const balanceById = new Map(balances.map((b) => [b.accountId, b]));
  const totalsById = new Map(totals.map((t) => [t.accountId, t]));

  return visibleAccounts(ctx).map((account) => {
    const balance = balanceById.get(account.id) ?? {
      accountId: account.id, balanceCents: 0, holdCents: 0, availableCents: 0,
    };
    const periodTotals = totalsById.get(account.id);
    const accountRules = rules.get(account.id) ?? [];
    const outstandingAdvanceCents = (advances.get(account.id) ?? [])
      .reduce((sum, a) => sum + a.amountCents, 0);

    // What rolled in from previous months = everything except this month's own
    // movement. Derived rather than stored, so it can never drift.
    const carriedInCents = balance.balanceCents - (periodTotals?.periodNetCents ?? 0);

    return {
      ...balance,
      account,
      canSpend: canSpendFromAccount(ctx, account.id),
      period,
      allocatedCents: periodTotals?.allocatedCents ?? 0,
      spentCents: periodTotals?.spentCents ?? 0,
      carriedInCents,
      outstandingAdvanceCents,
      nextPeriodOpeningCents: nextPeriodOpening({
        balanceCents: balance.balanceCents,
        nextAllocationCents: amountForPeriod(accountRules, upcoming) ?? 0,
        outstandingAdvanceCents,
      }),
    };
  });
}
