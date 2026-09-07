import { nextPeriod, periodOf, type FamilySettings } from '@budjo/shared';
import { advancesDue, planAllocations } from '../domain/allocation';
import { getAllocationRules, getLastAllocatedPeriods, getOpenAdvances, listAccounts } from '../db/repo';
import { ledgerInsert } from './ledger';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';

export interface MaintenanceResult {
  allocationsPosted: number;
  advancesRepaid: number;
  checksExpired: number;
  period: string;
}

/**
 * The monthly allocation, advance repayment, and stale-hold sweep.
 *
 * Runs from cron once a day *and* lazily on the first request of the day. Two
 * independent paths to the same writes, which is safe because every write here
 * is idempotent: allocations and repayments are guarded by partial unique
 * indexes, and expiring an already-expired check is a no-op.
 */
export async function runMaintenance(
  db: D1Database,
  family: FamilySettings,
  now = new Date(),
): Promise<MaintenanceResult> {
  const iso = nowIso(now);
  const currentPeriod = periodOf(now, family.timezone);

  // 1. Release holds whose checks timed out. Balance queries already ignore
  //    expired holds, so this is bookkeeping rather than correctness.
  const expired = await db
    .prepare(`UPDATE spend_checks SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`)
    .bind(iso)
    .run();

  const [accounts, rulesByAccount, lastAllocated, openAdvances] = await Promise.all([
    listAccounts(db),
    getAllocationRules(db),
    getLastAllocatedPeriods(db),
    getOpenAdvances(db),
  ]);

  const statements: D1PreparedStatement[] = [];
  let allocationsPosted = 0;
  let advancesRepaid = 0;

  for (const account of accounts) {
    const rules = rulesByAccount.get(account.id) ?? [];
    const planned = planAllocations({
      rules,
      lastAllocatedPeriod: lastAllocated.get(account.id) ?? null,
      currentPeriod,
    });

    for (const { period, amountCents } of planned) {
      statements.push(
        ledgerInsert(db, {
          accountId: account.id,
          actorUserId: null,
          type: 'allocation',
          amountCents,
          period,
          note: 'Monthly allocation',
          occurredAt: iso,
          createdBy: null,
        }),
      );
      allocationsPosted++;
    }

    // Advances come out of the allocation they were borrowed against.
    for (const advance of advancesDue(openAdvances.get(account.id) ?? [], currentPeriod)) {
      statements.push(
        ledgerInsert(db, {
          id: newId('led'),
          accountId: account.id,
          actorUserId: null,
          type: 'advance_repayment',
          amountCents: -advance.amountCents,
          period: advance.repayPeriod,
          advanceId: advance.id,
          note: 'Repaying advance',
          occurredAt: iso,
          createdBy: null,
        }),
      );
      statements.push(
        db.prepare('UPDATE advances SET repaid_at = ? WHERE id = ? AND repaid_at IS NULL')
          .bind(iso, advance.id),
      );
      advancesRepaid++;
    }
  }

  statements.push(db.prepare('UPDATE family SET last_maintenance_at = ? WHERE id = ?').bind(iso, family.id));

  if (statements.length > 0) await db.batch(statements);

  return {
    allocationsPosted,
    advancesRepaid,
    checksExpired: expired.meta?.changes ?? 0,
    period: currentPeriod,
  };
}

/** Cheap guard so the lazy path does real work at most once per UTC day. */
export function needsMaintenance(lastRunIso: string | null, now = new Date()): boolean {
  if (!lastRunIso) return true;
  return lastRunIso.slice(0, 10) < now.toISOString().slice(0, 10);
}

export function nextPeriodAfter(period: string): string {
  return nextPeriod(period);
}
