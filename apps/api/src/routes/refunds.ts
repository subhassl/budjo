import { Hono } from 'hono';
import {
  createRefundSchema, dateOf, isCalendarDate, occurredAtFor, periodFromDate, periodOf,
} from '@budjo/shared';
import type { AppEnv } from '../env';
import { assertCanSpend } from '../domain/access';
import { checkRefund, refundRejectionMessage, refundableCents } from '../domain/refunds';
import { getRefundedFor, isVoided } from '../db/repo';
import { auditInsert, ledgerInsert } from '../services/ledger';
import { badRequest, conflict, notFound } from '../lib/http';
import { idempotency } from '../middleware/idempotency';

export const refundRoutes = new Hono<AppEnv>();

/**
 * Record money coming back on a purchase.
 *
 * Deliberately not an admin action: returning something you bought is ordinary
 * use, and requiring an admin would mean a child could never record a return.
 * It needs spend access on the account the money is going back to.
 *
 * The refund is dated when the money arrived, which is usually days after the
 * purchase, so it lands in that month's totals rather than restating a month
 * that has already been reported. Backdate it if you would rather it netted off
 * against the original.
 */
refundRoutes.post('/refunds', idempotency, async (c) => {
  const parsed = createRefundSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const input = parsed.data;

  const entry = await c.env.DB
    .prepare(
      `SELECT id, account_id, type, amount_cents, category_id, card_id, note
         FROM ledger_entries WHERE id = ?`,
    )
    .bind(input.ledgerEntryId)
    .first<{
      id: string; account_id: string; type: string; amount_cents: number;
      category_id: string | null; card_id: string | null; note: string | null;
    }>();
  if (!entry) throw notFound('No such purchase');

  const ctx = c.get('access');
  assertCanSpend(ctx, entry.account_id);

  const [alreadyRefundedCents, voided] = await Promise.all([
    getRefundedFor(c.env.DB, entry.id),
    isVoided(c.env.DB, entry.id),
  ]);

  const target = {
    type: entry.type as 'spend',
    amountCents: entry.amount_cents,
    voided,
    alreadyRefundedCents,
  };
  const rejection = checkRefund(target, input.amountCents);
  if (rejection) {
    const message = refundRejectionMessage(rejection, refundableCents(target));
    throw rejection === 'exceeds_remaining' || rejection === 'voided'
      ? conflict(message)
      : badRequest(message);
  }

  const family = c.get('family');
  if (input.occurredOn) {
    if (!isCalendarDate(input.occurredOn)) throw badRequest('That is not a real date');
    if (input.occurredOn > dateOf(new Date(), family.timezone)) {
      throw badRequest('You cannot record a return in the future');
    }
  }

  const period = input.occurredOn ? periodFromDate(input.occurredOn) : periodOf(new Date(), family.timezone);
  const occurredAt = input.occurredOn
    ? occurredAtFor(input.occurredOn, family.timezone)
    : new Date().toISOString();

  await c.env.DB.batch([
    ledgerInsert(c.env.DB, {
      accountId: entry.account_id,
      actorUserId: ctx.user.id,
      type: 'refund',
      amountCents: input.amountCents,
      period,
      // Inherited so the return nets off the right category and the right card
      // when reconciling a statement.
      categoryId: entry.category_id,
      cardId: entry.card_id,
      refundsEntryId: entry.id,
      note: input.note?.trim() || `Returned: ${entry.note ?? 'purchase'}`,
      occurredAt,
      createdBy: ctx.user.id,
    }),
    auditInsert(c.env.DB, ctx.user.id, 'refund', { type: 'ledger_entry', id: entry.id }, {
      amountCents: input.amountCents,
      remainingAfter: refundableCents(target) - input.amountCents,
    }),
  ]);

  return c.json({
    ok: true,
    refundedCents: alreadyRefundedCents + input.amountCents,
    remainingRefundableCents: refundableCents(target) - input.amountCents,
  });
});
