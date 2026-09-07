import { Hono } from 'hono';
import { createAdvanceSchema, createTransferSchema } from '@budjo/shared';
import type { AppEnv } from '../env';
import { assertCanAdvance, assertCanTransfer } from '../domain/access';
import { createTransfer } from '../services/transfers';
import { takeAdvance } from '../services/advances';
import { auditInsert } from '../services/ledger';
import { badRequest, notFound } from '../lib/http';
import { idempotency } from '../middleware/idempotency';

export const moneyRoutes = new Hono<AppEnv>();

/**
 * Direct transfer out of your own personal account. There is deliberately no
 * route for the reverse direction out of Joint — access.canTransferFrom only
 * ever allows a personal account you own.
 */
moneyRoutes.post('/transfers', idempotency, async (c) => {
  const parsed = createTransferSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());

  const ctx = c.get('access');
  assertCanTransfer(ctx, parsed.data.fromAccountId, parsed.data.toAccountId);

  const result = await createTransfer(c.env.DB, ctx.user.id, c.get('family'), parsed.data);
  await auditInsert(c.env.DB, ctx.user.id, 'transfer', { type: 'account', id: parsed.data.fromAccountId }, {
    to: parsed.data.toAccountId,
    amountCents: parsed.data.amountCents,
  }).run();
  return c.json(result);
});

moneyRoutes.post('/advances', idempotency, async (c) => {
  const parsed = createAdvanceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());

  const ctx = c.get('access');
  assertCanAdvance(ctx, parsed.data.accountId);
  const account = ctx.accounts.find((a) => a.id === parsed.data.accountId);
  if (!account) throw notFound('No such account');

  const result = await takeAdvance(
    c.env.DB, ctx.user.id, c.get('family'), account, parsed.data.amountCents,
  );
  await auditInsert(c.env.DB, ctx.user.id, 'advance', { type: 'account', id: account.id }, {
    amountCents: parsed.data.amountCents,
    repayPeriod: result.repayPeriod,
  }).run();
  return c.json(result);
});
