import type { Account, AccountBalance, Card, Category, FamilySettings, LedgerEntry, SpendCheck, User } from '@budjo/shared';
import type { AllocationRule, OpenAdvance } from '../domain/allocation';
import {
  toAccount, toCard, toCategory, toFamily, toLedgerEntry, toSpendCheck, toUser,
  type AccountRow, type CardRow, type CategoryRow, type FamilyRow,
  type LedgerRow, type SpendCheckRow, type UserRow,
} from './rows';

/** Read-side queries. Writes live in services/, where they can be batched. */

export async function getFamily(db: D1Database): Promise<FamilySettings> {
  const row = await db
    .prepare(`SELECT id, name, timezone, currency, reserve_threshold_cents, hold_ttl_hours,
              edit_window_hours FROM family LIMIT 1`)
    .first<FamilyRow>();
  if (!row) throw new Error('Family row missing — has the database been seeded?');
  return toFamily(row);
}

export async function getUser(db: D1Database, userId: string): Promise<User | null> {
  const row = await db
    .prepare('SELECT id, family_id, display_name, email, role, status FROM users WHERE id = ?')
    .bind(userId)
    .first<UserRow>();
  return row ? toUser(row) : null;
}

export async function listUsers(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare('SELECT id, family_id, display_name, email, role, status FROM users ORDER BY created_at')
    .all<UserRow>();
  return results.map(toUser);
}

export async function listAccounts(db: D1Database): Promise<Account[]> {
  const { results } = await db
    .prepare(
      `SELECT id, family_id, kind, owner_user_id, name, sort_order, allow_advance,
              max_advance_cents, archived_at
         FROM accounts
        WHERE archived_at IS NULL
        ORDER BY sort_order, name`,
    )
    .all<AccountRow>();
  return results.map(toAccount);
}

export async function listAccessibleAccountIds(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT account_id FROM account_access WHERE user_id = ?')
    .bind(userId)
    .all<{ account_id: string }>();
  return results.map((r) => r.account_id);
}

export async function listAccountAccess(db: D1Database): Promise<{ accountId: string; userId: string }[]> {
  const { results } = await db
    .prepare('SELECT account_id, user_id FROM account_access')
    .all<{ account_id: string; user_id: string }>();
  return results.map((r) => ({ accountId: r.account_id, userId: r.user_id }));
}

/**
 * Balance and holds for every account in one round trip.
 *
 * Holds only count *unexpired* pending checks, so a forgotten check stops
 * consuming budget the moment it times out — correctness never depends on the
 * sweep job having run.
 */
export async function getBalances(db: D1Database, nowIso: string): Promise<AccountBalance[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id AS account_id,
              COALESCE((SELECT SUM(le.amount_cents) FROM ledger_entries le
                         WHERE le.account_id = a.id), 0) AS balance_cents,
              COALESCE((SELECT SUM(sc.estimated_cents) FROM spend_checks sc
                         WHERE sc.account_id = a.id
                           AND sc.status = 'pending'
                           AND sc.expires_at > ?1), 0) AS hold_cents
         FROM accounts a
        WHERE a.archived_at IS NULL`,
    )
    .bind(nowIso)
    .all<{ account_id: string; balance_cents: number; hold_cents: number }>();

  return results.map((r) => ({
    accountId: r.account_id,
    balanceCents: r.balance_cents,
    holdCents: r.hold_cents,
    availableCents: r.balance_cents - r.hold_cents,
  }));
}

export async function getBalance(
  db: D1Database,
  accountId: string,
  nowIso: string,
): Promise<AccountBalance> {
  const row = await db
    .prepare(
      `SELECT COALESCE((SELECT SUM(amount_cents) FROM ledger_entries
                         WHERE account_id = ?1), 0) AS balance_cents,
              COALESCE((SELECT SUM(estimated_cents) FROM spend_checks
                         WHERE account_id = ?1 AND status = 'pending'
                           AND expires_at > ?2), 0) AS hold_cents`,
    )
    .bind(accountId, nowIso)
    .first<{ balance_cents: number; hold_cents: number }>();
  const balanceCents = row?.balance_cents ?? 0;
  const holdCents = row?.hold_cents ?? 0;
  return { accountId, balanceCents, holdCents, availableCents: balanceCents - holdCents };
}

export interface PeriodTotals {
  accountId: string;
  allocatedCents: number;
  spentCents: number;
  periodNetCents: number;
}

export async function getPeriodTotals(db: D1Database, period: string): Promise<PeriodTotals[]> {
  const { results } = await db
    .prepare(
      `SELECT account_id,
              COALESCE(SUM(CASE WHEN type = 'allocation' THEN amount_cents END), 0) AS allocated,
              COALESCE(SUM(CASE
                WHEN type IN ('spend','refund') THEN amount_cents
                -- A correction reverses whatever it points at, so it belongs in
                -- the same total. Without this, voiding a spend leaves the
                -- month still reporting it.
                WHEN type = 'void' AND voids_entry_id IN (
                  SELECT id FROM ledger_entries WHERE type IN ('spend','refund')
                ) THEN amount_cents
              END), 0) AS spend_net,
              COALESCE(SUM(amount_cents), 0) AS net
         FROM ledger_entries
        WHERE period = ?
        GROUP BY account_id`,
    )
    .bind(period)
    .all<{ account_id: string; allocated: number; spend_net: number; net: number }>();

  return results.map((r) => ({
    accountId: r.account_id,
    allocatedCents: r.allocated,
    spentCents: -r.spend_net, // spends are negative; report them positive
    periodNetCents: r.net,
  }));
}

export async function getAllocationRules(db: D1Database, accountId?: string): Promise<Map<string, AllocationRule[]>> {
  const stmt = accountId
    ? db.prepare(
        `SELECT account_id, amount_cents, effective_from, effective_to
           FROM allocation_rules WHERE account_id = ? ORDER BY effective_from`,
      ).bind(accountId)
    : db.prepare(
        `SELECT account_id, amount_cents, effective_from, effective_to
           FROM allocation_rules ORDER BY effective_from`,
      );

  const { results } = await stmt.all<{
    account_id: string; amount_cents: number; effective_from: string; effective_to: string | null;
  }>();

  const map = new Map<string, AllocationRule[]>();
  for (const r of results) {
    const list = map.get(r.account_id) ?? [];
    list.push({ amountCents: r.amount_cents, effectiveFrom: r.effective_from, effectiveTo: r.effective_to });
    map.set(r.account_id, list);
  }
  return map;
}

export async function getLastAllocatedPeriods(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare(
      `SELECT account_id, MAX(period) AS last_period
         FROM ledger_entries WHERE type = 'allocation' GROUP BY account_id`,
    )
    .all<{ account_id: string; last_period: string }>();
  return new Map(results.map((r) => [r.account_id, r.last_period]));
}

export async function getOpenAdvances(db: D1Database, accountId?: string): Promise<Map<string, OpenAdvance[]>> {
  const stmt = accountId
    ? db.prepare(
        `SELECT id, account_id, amount_cents, repay_period FROM advances
          WHERE repaid_at IS NULL AND account_id = ?`,
      ).bind(accountId)
    : db.prepare(
        'SELECT id, account_id, amount_cents, repay_period FROM advances WHERE repaid_at IS NULL',
      );

  const { results } = await stmt.all<{
    id: string; account_id: string; amount_cents: number; repay_period: string;
  }>();

  const map = new Map<string, OpenAdvance[]>();
  for (const r of results) {
    const list = map.get(r.account_id) ?? [];
    list.push({ id: r.id, amountCents: r.amount_cents, repayPeriod: r.repay_period });
    map.set(r.account_id, list);
  }
  return map;
}

export async function listCategories(db: D1Database): Promise<Category[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, icon, sort_order, counts_against_budget FROM categories
        WHERE archived_at IS NULL ORDER BY sort_order, name`,
    )
    .all<CategoryRow>();
  return results.map(toCategory);
}

export async function listCards(db: D1Database): Promise<Card[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, issuer, last4, reward_note, statement_close_day, due_day
         FROM cards WHERE archived_at IS NULL ORDER BY sort_order, name`,
    )
    .all<CardRow>();
  return results.map(toCard);
}

/** category -> preferred card, driving the "use the Amex for this" suggestion. */
export async function listCardRules(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db
    .prepare(
      `SELECT category_id, card_id FROM category_card_rules
        WHERE priority = (SELECT MIN(priority) FROM category_card_rules r2
                           WHERE r2.category_id = category_card_rules.category_id)`,
    )
    .all<{ category_id: string; card_id: string }>();
  const out: Record<string, string> = {};
  for (const r of results) out[r.category_id] = r.card_id;
  return out;
}

export async function getSpendCheck(db: D1Database, id: string): Promise<SpendCheck | null> {
  const row = await db.prepare('SELECT * FROM spend_checks WHERE id = ?').bind(id).first<SpendCheckRow>();
  return row ? toSpendCheck(row) : null;
}

export async function listPendingChecks(
  db: D1Database,
  accountIds: readonly string[],
  nowIso: string,
): Promise<SpendCheck[]> {
  if (accountIds.length === 0) return [];
  const placeholders = accountIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT * FROM spend_checks
        WHERE account_id IN (${placeholders})
          AND status = 'pending' AND expires_at > ?
        ORDER BY created_at DESC`,
    )
    .bind(...accountIds, nowIso)
    .all<SpendCheckRow>();
  return results.map(toSpendCheck);
}

export interface LedgerQuery {
  accountIds: readonly string[];
  /** Day bounds on when it happened, for a custom range. */
  from?: string;
  to?: string;
  /**
   * Month bounds ('YYYY-MM'). Preferred for month-shaped filters: `period` is
   * the month an entry belongs to in the family's timezone, whereas
   * occurred_at is a UTC instant. A Tuesday-evening spend in California is
   * already Wednesday in UTC, so filtering months by timestamp drops entries
   * at the edges.
   */
  periodFrom?: string;
  periodTo?: string;
  categoryId?: string;
  cardId?: string;
  limit?: number;
  cursor?: string;
}

export async function listLedger(db: D1Database, q: LedgerQuery): Promise<{ entries: LedgerEntry[]; nextCursor: string | null }> {
  if (q.accountIds.length === 0) return { entries: [], nextCursor: null };
  const limit = Math.min(q.limit ?? 50, 200);
  const clauses: string[] = [`account_id IN (${q.accountIds.map(() => '?').join(',')})`];
  const binds: unknown[] = [...q.accountIds];

  if (q.from) { clauses.push('occurred_at >= ?'); binds.push(q.from); }
  if (q.to) { clauses.push('occurred_at <= ?'); binds.push(q.to); }
  if (q.periodFrom) { clauses.push('period >= ?'); binds.push(q.periodFrom); }
  if (q.periodTo) { clauses.push('period <= ?'); binds.push(q.periodTo); }
  if (q.categoryId) { clauses.push('category_id = ?'); binds.push(q.categoryId); }
  if (q.cardId) { clauses.push('card_id = ?'); binds.push(q.cardId); }
  // Cursor is the last row's (occurred_at, id) pair, keeping paging stable when
  // several entries share a timestamp.
  if (q.cursor) {
    const [ts, id] = q.cursor.split('|');
    clauses.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))');
    binds.push(ts, ts, id);
  }

  const { results } = await db
    .prepare(
      `SELECT * FROM ledger_entries WHERE ${clauses.join(' AND ')}
        ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<LedgerRow>();

  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const last = page[page.length - 1];
  return {
    entries: page.map(toLedgerEntry),
    nextCursor: hasMore && last ? `${last.occurred_at}|${last.id}` : null,
  };
}
