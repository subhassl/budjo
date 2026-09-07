import type { LedgerType } from '@budjo/shared';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';

export interface NewLedgerEntry {
  id?: string;
  accountId: string;
  actorUserId: string | null;
  type: LedgerType;
  amountCents: number;
  period: string;
  categoryId?: string | null;
  cardId?: string | null;
  spendCheckId?: string | null;
  counterpartyAccountId?: string | null;
  advanceId?: string | null;
  voidsEntryId?: string | null;
  note?: string | null;
  occurredAt?: string;
  createdBy: string | null;
}

const INSERT_SQL = `
  INSERT OR IGNORE INTO ledger_entries
    (id, account_id, actor_user_id, type, amount_cents, period, category_id, card_id,
     spend_check_id, counterparty_account_id, advance_id, voids_entry_id, note,
     occurred_at, created_by, created_at)
  VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)`;

/**
 * Build the insert for one ledger entry. `INSERT OR IGNORE` is what makes the
 * allocation and advance-repayment jobs idempotent: the partial unique indexes
 * reject a second allocation for the same account and month, and the job can
 * therefore run thirty times a month without double-crediting anyone.
 */
export function ledgerInsert(db: D1Database, entry: NewLedgerEntry): D1PreparedStatement {
  const now = nowIso();
  return db.prepare(INSERT_SQL).bind(
    entry.id ?? newId('led'),
    entry.accountId,
    entry.actorUserId,
    entry.type,
    entry.amountCents,
    entry.period,
    entry.categoryId ?? null,
    entry.cardId ?? null,
    entry.spendCheckId ?? null,
    entry.counterpartyAccountId ?? null,
    entry.advanceId ?? null,
    entry.voidsEntryId ?? null,
    entry.note ?? null,
    entry.occurredAt ?? now,
    entry.createdBy,
    now,
  );
}

export function auditInsert(
  db: D1Database,
  actorUserId: string | null,
  action: string,
  target: { type: string; id: string } | null,
  detail?: unknown,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, detail_json, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(
      newId('aud'),
      actorUserId,
      action,
      target?.type ?? null,
      target?.id ?? null,
      detail === undefined ? null : JSON.stringify(detail),
      nowIso(),
    );
}
