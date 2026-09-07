import { periodOf, type FamilySettings } from '@budjo/shared';
import { getBalance } from '../db/repo';
import { ledgerInsert } from './ledger';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';
import { conflict } from '../lib/http';

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  note?: string | null;
}

/**
 * Move money out of a personal account you own, into another account.
 *
 * Access rules (domain/access.ts) already established that the source is your
 * own personal account, which is what makes joint -> personal structurally
 * impossible rather than merely disallowed.
 *
 * Both legs go in one D1 batch, which runs as a single transaction. The credit
 * leg is conditioned on the debit leg existing, so if the debit's funds guard
 * fails, neither row is written and nobody gets money from nowhere.
 */
export async function createTransfer(
  db: D1Database,
  actorUserId: string,
  family: FamilySettings,
  input: TransferInput,
  now = new Date(),
): Promise<{ outEntryId: string; inEntryId: string }> {
  const iso = nowIso(now);
  const period = periodOf(now, family.timezone);
  const outId = newId('led');
  const inId = newId('led');

  const before = await getBalance(db, input.fromAccountId, iso);
  if (input.amountCents > before.availableCents) {
    throw conflict('That is more than you have available to send');
  }

  const debit = db
    .prepare(
      `INSERT INTO ledger_entries
         (id, account_id, actor_user_id, type, amount_cents, period,
          counterparty_account_id, note, occurred_at, created_by, created_at)
       SELECT ?1,?2,?3,'transfer_out',?4,?5,?6,?7,?8,?3,?8
        WHERE ?9 <= (
          COALESCE((SELECT SUM(amount_cents) FROM ledger_entries WHERE account_id = ?2), 0)
          - COALESCE((SELECT SUM(estimated_cents) FROM spend_checks
                       WHERE account_id = ?2 AND status = 'pending' AND expires_at > ?8), 0))`,
    )
    .bind(
      outId, input.fromAccountId, actorUserId, -input.amountCents, period,
      input.toAccountId, input.note ?? null, iso, input.amountCents,
    );

  const credit = db
    .prepare(
      `INSERT INTO ledger_entries
         (id, account_id, actor_user_id, type, amount_cents, period,
          counterparty_account_id, note, occurred_at, created_by, created_at)
       SELECT ?1,?2,?3,'transfer_in',?4,?5,?6,?7,?8,?3,?8
        WHERE EXISTS (SELECT 1 FROM ledger_entries WHERE id = ?9)`,
    )
    .bind(
      inId, input.toAccountId, actorUserId, input.amountCents, period,
      input.fromAccountId, input.note ?? null, iso, outId,
    );

  await db.batch([debit, credit]);

  const landed = await db.prepare('SELECT id FROM ledger_entries WHERE id = ?').bind(inId).first<{ id: string }>();
  if (!landed) throw conflict('That is more than you have available to send');

  return { outEntryId: outId, inEntryId: inId };
}
