import { Hono } from 'hono';
import {
  adjustmentSchema, createInviteSchema, createMemberSchema, dateOf, editLedgerEntrySchema,
  isCalendarDate, occurredAtFor, periodFromDate, periodOf, setAccountAccessSchema,
  setAllocationSchema, updateAccountSchema, updateFamilySchema, updateUserSchema,
  upsertCardSchema, upsertCategorySchema, voidEntrySchema, type LedgerType,
} from '@budjo/shared';
import type { AppEnv } from '../env';
import { assertAdmin } from '../domain/access';
import {
  canEditType, canVoidType, editModeFor, editWindowClosesAt, isValidAmountForType,
  isWithinEditWindow, whyNotEditable,
} from '../domain/ledgerEdits';
import { blocksEditing, checkRefund, refundRejectionMessage, refundableCents } from '../domain/refunds';
import { getRefundedFor } from '../db/repo';
import { auditInsert, ledgerInsert } from '../services/ledger';
import { runMaintenance } from '../services/maintenance';
import { runBackup } from '../services/backup';
import { listAccountAccess, listAccounts, listCards, listCategories, listUsers } from '../db/repo';
import { badRequest, conflict, notFound } from '../lib/http';
import { hashCode, newId, newInviteCode } from '../lib/ids';
import { isoPlusDays, nowIso } from '../lib/time';

export const adminRoutes = new Hono<AppEnv>();

/** Every route below is admin-only; membership is checked once, here. */
adminRoutes.use('*', async (c, next) => {
  assertAdmin(c.get('user'));
  await next();
});

adminRoutes.get('/overview', async (c) => {
  const [users, accounts, access, categories, cards] = await Promise.all([
    listUsers(c.env.DB),
    listAccounts(c.env.DB),
    listAccountAccess(c.env.DB),
    listCategories(c.env.DB),
    listCards(c.env.DB),
  ]);
  const { results: rules } = await c.env.DB
    .prepare(
      `SELECT account_id, amount_cents, effective_from FROM allocation_rules
        ORDER BY account_id, effective_from DESC`,
    )
    .all<{ account_id: string; amount_cents: number; effective_from: string }>();

  return c.json({
    users, accounts, access, categories, cards,
    family: c.get('family'),
    allocationRules: rules.map((r) => ({
      accountId: r.account_id,
      amountCents: r.amount_cents,
      effectiveFrom: r.effective_from,
    })),
  });
});

/**
 * Add a family member: user, their personal account, their allocation, any
 * joint access, and a single-use invite code — one flow, because doing these
 * separately is how someone ends up with an account and no way to sign in.
 */
adminRoutes.post('/members', async (c) => {
  const parsed = createMemberSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const input = parsed.data;

  const family = c.get('family');
  const actor = c.get('user');
  const userId = newId('usr');
  const accountId = newId('acc');
  const now = nowIso();
  const period = periodOf(new Date(), family.timezone);
  const code = newInviteCode();
  const codeHash = await hashCode(code, c.env.SESSION_SECRET);

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'INSERT INTO users (id, family_id, display_name, email, role, status, created_at) VALUES (?,?,?,?,?,?,?)',
    ).bind(userId, family.id, input.displayName, input.email ?? null, input.role, 'active', now),

    c.env.DB.prepare(
      `INSERT INTO accounts (id, family_id, kind, owner_user_id, name, sort_order, allow_advance, max_advance_cents, archived_at)
       VALUES (?,?,'personal',?,?,?,?,NULL,NULL)`,
    ).bind(accountId, family.id, userId, input.accountName ?? input.displayName, 10, input.allowAdvance ? 1 : 0),

    c.env.DB.prepare('INSERT INTO account_access (account_id, user_id, created_at) VALUES (?,?,?)')
      .bind(accountId, userId, now),

    c.env.DB.prepare(
      `INSERT INTO allocation_rules (id, account_id, amount_cents, effective_from, created_by, created_at)
       VALUES (?,?,?,?,?,?)`,
    ).bind(newId('alr'), accountId, input.monthlyAllocationCents, period, actor.id, now),

    c.env.DB.prepare(
      'INSERT INTO invites (id, user_id, code_hash, expires_at, created_by, created_at) VALUES (?,?,?,?,?,?)',
    ).bind(newId('inv'), userId, codeHash, isoPlusDays(14), actor.id, now),

    auditInsert(c.env.DB, actor.id, 'member.create', { type: 'user', id: userId }, {
      displayName: input.displayName, role: input.role,
      monthlyAllocationCents: input.monthlyAllocationCents,
    }),
  ];

  for (const jointId of input.joinJointAccountIds) {
    statements.push(
      c.env.DB.prepare('INSERT OR IGNORE INTO account_access (account_id, user_id, created_at) VALUES (?,?,?)')
        .bind(jointId, userId, now),
    );
  }

  await c.env.DB.batch(statements);

  // Post their first allocation now. The daily maintenance gate has usually
  // already fired by this point, and a new member with no money until tomorrow
  // is a confusing way to start.
  await runMaintenance(c.env.DB, family);

  // The code is shown once, here. Only its HMAC is stored.
  return c.json({ userId, accountId, inviteCode: code, expiresAt: isoPlusDays(14) }, 201);
});

adminRoutes.patch('/users/:id', async (c) => {
  const parsed = updateUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const id = c.req.param('id');
  const fields = parsed.data;

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (fields.displayName !== undefined) { sets.push('display_name = ?'); binds.push(fields.displayName); }
  if (fields.email !== undefined) { sets.push('email = ?'); binds.push(fields.email); }
  if (fields.role !== undefined) { sets.push('role = ?'); binds.push(fields.role); }
  if (fields.status !== undefined) { sets.push('status = ?'); binds.push(fields.status); }
  if (sets.length === 0) throw badRequest('Nothing to update');

  // Don't let the last admin demote or disable themselves into a locked-out family.
  if (fields.role === 'member' || fields.status === 'disabled') {
    const row = await c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?`)
      .bind(id)
      .first<{ n: number }>();
    if ((row?.n ?? 0) === 0) throw conflict('There must be at least one active admin');
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id),
    auditInsert(c.env.DB, c.get('user').id, 'user.update', { type: 'user', id }, fields),
  ]);
  return c.json({ ok: true });
});

adminRoutes.post('/invites', async (c) => {
  const parsed = createInviteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());

  const code = newInviteCode();
  const codeHash = await hashCode(code, c.env.SESSION_SECRET);
  const expiresAt = isoPlusDays(14);
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO invites (id, user_id, code_hash, expires_at, created_by, created_at) VALUES (?,?,?,?,?,?)',
    ).bind(newId('inv'), parsed.data.userId, codeHash, expiresAt, c.get('user').id, nowIso()),
    auditInsert(c.env.DB, c.get('user').id, 'invite.create', { type: 'user', id: parsed.data.userId }),
  ]);
  return c.json({ inviteCode: code, expiresAt });
});

adminRoutes.patch('/accounts/:id', async (c) => {
  const parsed = updateAccountSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const id = c.req.param('id');
  const f = parsed.data;

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (f.name !== undefined) { sets.push('name = ?'); binds.push(f.name); }
  if (f.allowAdvance !== undefined) { sets.push('allow_advance = ?'); binds.push(f.allowAdvance ? 1 : 0); }
  if (f.maxAdvanceCents !== undefined) { sets.push('max_advance_cents = ?'); binds.push(f.maxAdvanceCents); }
  if (f.sortOrder !== undefined) { sets.push('sort_order = ?'); binds.push(f.sortOrder); }
  if (sets.length === 0) throw badRequest('Nothing to update');

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id),
    auditInsert(c.env.DB, c.get('user').id, 'account.update', { type: 'account', id }, f),
  ]);
  return c.json({ ok: true });
});

/** Who may spend from a joint account. Personal accounts keep their owner. */
adminRoutes.post('/account-access', async (c) => {
  const parsed = setAccountAccessSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const { accountId, userIds } = parsed.data;

  const account = await c.env.DB
    .prepare('SELECT kind, owner_user_id FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ kind: string; owner_user_id: string | null }>();
  if (!account) throw notFound('No such account');
  if (account.kind === 'personal') throw badRequest('A personal account always belongs to its owner');

  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare('DELETE FROM account_access WHERE account_id = ?').bind(accountId),
    auditInsert(c.env.DB, c.get('user').id, 'account.access', { type: 'account', id: accountId }, { userIds }),
  ];
  for (const userId of userIds) {
    statements.push(
      c.env.DB.prepare('INSERT INTO account_access (account_id, user_id, created_at) VALUES (?,?,?)')
        .bind(accountId, userId, now),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

/**
 * Change an allocation. Inserting a new effective-dated rule rather than
 * editing the old one is what keeps a past month's history explainable.
 */
adminRoutes.post('/allocations', async (c) => {
  const parsed = setAllocationSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const { accountId, amountCents, effectiveFrom } = parsed.data;

  const actor = c.get('user');
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO allocation_rules (id, account_id, amount_cents, effective_from, created_by, created_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(account_id, effective_from)
       DO UPDATE SET amount_cents = excluded.amount_cents, created_by = excluded.created_by`,
    ).bind(newId('alr'), accountId, amountCents, effectiveFrom, actor.id, nowIso()),
    auditInsert(c.env.DB, actor.id, 'allocation.set', { type: 'account', id: accountId }, parsed.data),
  ]);

  // If that month's allocation has already been posted, the unique index means
  // the entry itself cannot change — so post the difference as an adjustment.
  // The ledger stays append-only and the balance still ends up correct.
  const posted = await c.env.DB
    .prepare(`SELECT id, amount_cents FROM ledger_entries
               WHERE account_id = ? AND period = ? AND type = 'allocation'`)
    .bind(accountId, effectiveFrom)
    .first<{ id: string; amount_cents: number }>();

  if (posted) {
    const delta = amountCents - posted.amount_cents;
    if (delta !== 0) {
      await ledgerInsert(c.env.DB, {
        accountId,
        actorUserId: actor.id,
        type: 'adjustment',
        amountCents: delta,
        period: effectiveFrom,
        note: `Allocation for ${effectiveFrom} changed to ${(amountCents / 100).toFixed(2)}`,
        createdBy: actor.id,
      }).run();
    }
  } else {
    // Not yet posted: if that month has arrived, post it now rather than
    // waiting for tomorrow's run.
    await runMaintenance(c.env.DB, c.get('family'));
  }

  return c.json({ ok: true, adjusted: Boolean(posted) });
});

adminRoutes.patch('/family', async (c) => {
  const parsed = updateFamilySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const f = parsed.data;

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (f.name !== undefined) { sets.push('name = ?'); binds.push(f.name); }
  if (f.timezone !== undefined) { sets.push('timezone = ?'); binds.push(f.timezone); }
  if (f.reserveThresholdCents !== undefined) { sets.push('reserve_threshold_cents = ?'); binds.push(f.reserveThresholdCents); }
  if (f.holdTtlHours !== undefined) { sets.push('hold_ttl_hours = ?'); binds.push(f.holdTtlHours); }
  if (f.editWindowHours !== undefined) { sets.push('edit_window_hours = ?'); binds.push(f.editWindowHours); }
  if (sets.length === 0) throw badRequest('Nothing to update');

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE family SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, c.get('family').id),
    auditInsert(c.env.DB, c.get('user').id, 'family.update', { type: 'family', id: c.get('family').id }, f),
  ]);
  return c.json({ ok: true });
});

adminRoutes.post('/categories', async (c) => {
  const parsed = upsertCategorySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const id = newId('cat');
  await c.env.DB
    .prepare(
      `INSERT INTO categories (id, family_id, name, icon, sort_order, counts_against_budget)
       VALUES (?,?,?,?,?,?)`,
    )
    .bind(id, c.get('family').id, parsed.data.name, parsed.data.icon, parsed.data.sortOrder,
      parsed.data.countsAgainstBudget ? 1 : 0)
    .run();
  return c.json({ id }, 201);
});

adminRoutes.patch('/categories/:id', async (c) => {
  const parsed = upsertCategorySchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const f = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (f.name !== undefined) { sets.push('name = ?'); binds.push(f.name); }
  if (f.icon !== undefined) { sets.push('icon = ?'); binds.push(f.icon); }
  if (f.sortOrder !== undefined) { sets.push('sort_order = ?'); binds.push(f.sortOrder); }
  if (f.countsAgainstBudget !== undefined) { sets.push('counts_against_budget = ?'); binds.push(f.countsAgainstBudget ? 1 : 0); }
  if (sets.length === 0) throw badRequest('Nothing to update');
  await c.env.DB.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, c.req.param('id')).run();
  return c.json({ ok: true });
});

adminRoutes.delete('/categories/:id', async (c) => {
  await c.env.DB.prepare('UPDATE categories SET archived_at = ? WHERE id = ?')
    .bind(nowIso(), c.req.param('id')).run();
  return c.json({ ok: true });
});

adminRoutes.post('/cards', async (c) => {
  const parsed = upsertCardSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const d = parsed.data;
  const id = newId('crd');
  await c.env.DB
    .prepare(
      `INSERT INTO cards (id, family_id, name, issuer, last4, reward_note, statement_close_day, due_day, sort_order)
       VALUES (?,?,?,?,?,?,?,?,0)`,
    )
    .bind(id, c.get('family').id, d.name, d.issuer ?? null, d.last4 ?? null, d.rewardNote ?? null,
      d.statementCloseDay ?? null, d.dueDay ?? null)
    .run();
  return c.json({ id }, 201);
});

adminRoutes.patch('/cards/:id', async (c) => {
  const parsed = upsertCardSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const f = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [];
  const map: Record<string, string> = {
    name: 'name', issuer: 'issuer', last4: 'last4', rewardNote: 'reward_note',
    statementCloseDay: 'statement_close_day', dueDay: 'due_day',
  };
  for (const [key, column] of Object.entries(map)) {
    const value = (f as Record<string, unknown>)[key];
    if (value !== undefined) { sets.push(`${column} = ?`); binds.push(value); }
  }
  if (sets.length === 0) throw badRequest('Nothing to update');
  await c.env.DB.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, c.req.param('id')).run();
  return c.json({ ok: true });
});

adminRoutes.delete('/cards/:id', async (c) => {
  await c.env.DB.prepare('UPDATE cards SET archived_at = ? WHERE id = ?')
    .bind(nowIso(), c.req.param('id')).run();
  return c.json({ ok: true });
});

adminRoutes.post('/card-rules', async (c) => {
  const body = await c.req.json<{ categoryId: string; cardId: string }>().catch(() => null);
  if (!body?.categoryId || !body?.cardId) throw badRequest('categoryId and cardId are required');
  await c.env.DB
    .prepare(
      `INSERT INTO category_card_rules (category_id, card_id, priority) VALUES (?,?,1)
       ON CONFLICT(category_id, priority) DO UPDATE SET card_id = excluded.card_id`,
    )
    .bind(body.categoryId, body.cardId)
    .run();
  return c.json({ ok: true });
});

/** A manual correction. Requires a reason, and is always visible in history. */
adminRoutes.post('/adjustments', async (c) => {
  const parsed = adjustmentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const { accountId, amountCents, note } = parsed.data;
  const family = c.get('family');
  const actor = c.get('user');

  await c.env.DB.batch([
    ledgerInsert(c.env.DB, {
      accountId,
      actorUserId: actor.id,
      type: 'adjustment',
      amountCents,
      period: periodOf(new Date(), family.timezone),
      note,
      createdBy: actor.id,
    }),
    auditInsert(c.env.DB, actor.id, 'adjustment', { type: 'account', id: accountId }, parsed.data),
  ]);
  return c.json({ ok: true });
});

/**
 * Corrections never rewrite history: a void is a new, opposite entry that
 * points at the original, so "why is my balance this number?" stays answerable.
 */
adminRoutes.post('/void', async (c) => {
  const parsed = voidEntrySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());

  const entry = await c.env.DB
    .prepare('SELECT id, account_id, amount_cents, period, type FROM ledger_entries WHERE id = ?')
    .bind(parsed.data.ledgerEntryId)
    .first<{ id: string; account_id: string; amount_cents: number; period: string; type: string }>();
  if (!entry) throw notFound('No such ledger entry');
  if (entry.type === 'void') throw conflict('That entry is already a correction');

  const existing = await c.env.DB
    .prepare(`SELECT id FROM ledger_entries WHERE voids_entry_id = ? AND type = 'void'`)
    .bind(entry.id)
    .first<{ id: string }>();
  if (existing) throw conflict('That entry has already been voided');

  if (!canVoidType(entry.type as LedgerType)) {
    throw conflict(whyNotEditable(entry.type as LedgerType));
  }
  if (blocksEditing(await getRefundedFor(c.env.DB, entry.id))) {
    throw conflict('This purchase has a return recorded against it — remove that first');
  }

  const actor = c.get('user');
  await c.env.DB.batch([
    ledgerInsert(c.env.DB, {
      accountId: entry.account_id,
      actorUserId: actor.id,
      type: 'void',
      amountCents: -entry.amount_cents,
      // The reversal belongs to the month it reverses. Putting it in today's
      // month would leave that month still reporting the spend and this one
      // reporting a phantom credit.
      period: entry.period,
      voidsEntryId: entry.id,
      note: parsed.data.reason,
      createdBy: actor.id,
    }),
    auditInsert(c.env.DB, actor.id, 'void', { type: 'ledger_entry', id: entry.id }, parsed.data),
  ]);
  return c.json({ ok: true });
});

/**
 * Correct a history entry.
 *
 * The ledger is append-only, so this is a void of the original plus a fresh
 * entry carrying the corrected values — both in one batch, so history can never
 * show a reversal without its replacement. The UI presents it as an edit; the
 * data keeps the trail, which is what makes "why is my balance this number?"
 * answerable a year later.
 */
adminRoutes.post('/ledger/:id/edit', async (c) => {
  const parsed = editLedgerEntrySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const input = parsed.data;

  const entry = await c.env.DB
    .prepare(
      `SELECT id, account_id, type, amount_cents, period, category_id, card_id,
              spend_check_id, refunds_entry_id, note, occurred_at, created_at
         FROM ledger_entries WHERE id = ?`,
    )
    .bind(c.req.param('id'))
    .first<{
      id: string; account_id: string; type: string; amount_cents: number; period: string;
      category_id: string | null; card_id: string | null; spend_check_id: string | null;
      refunds_entry_id: string | null; note: string | null; occurred_at: string; created_at: string;
    }>();
  if (!entry) throw notFound('No such ledger entry');

  const type = entry.type as LedgerType;
  if (!canEditType(type)) throw conflict(whyNotEditable(type));

  const already = await c.env.DB
    .prepare(`SELECT id FROM ledger_entries WHERE voids_entry_id = ? AND type = 'void'`)
    .bind(entry.id)
    .first<{ id: string }>();
  if (already) throw conflict('That entry has already been corrected');

  // Refunds were sized against this amount. Changing it underneath them could
  // leave more returned than was ever spent.
  if (blocksEditing(await getRefundedFor(c.env.DB, entry.id))) {
    throw conflict('This purchase has a return recorded against it — remove that first');
  }

  const family = c.get('family');
  const actor = c.get('user');

  const mode = input.forceCorrection
    ? 'correction'
    : editModeFor(
        { type, createdAt: entry.created_at, alreadyCorrected: false },
        { editWindowHours: family.editWindowHours },
      );

  // A correction is permanent and public in history, so it has to say why.
  // A fix inside the window is a typo; demanding a reason would be theatre.
  if (mode === 'correction' && !input.reason?.trim()) {
    throw badRequest('A reason is required when correcting an older entry');
  }

  const amountCents = input.amountCents ?? entry.amount_cents;
  if (!isValidAmountForType(type, amountCents)) {
    throw badRequest(
      type === 'spend' ? 'A spend has to stay a spend' : 'That amount is not valid for this entry',
    );
  }

  // Raising a refund must not take it past what the purchase was.
  if (type === 'refund' && entry.refunds_entry_id) {
    const original = await c.env.DB
      .prepare('SELECT type, amount_cents FROM ledger_entries WHERE id = ?')
      .bind(entry.refunds_entry_id)
      .first<{ type: string; amount_cents: number }>();
    if (original) {
      const others = (await getRefundedFor(c.env.DB, entry.refunds_entry_id)) - entry.amount_cents;
      const target = {
        type: original.type as 'spend',
        amountCents: original.amount_cents,
        voided: false,
        alreadyRefundedCents: others,
      };
      const bad = checkRefund(target, amountCents);
      if (bad) throw conflict(refundRejectionMessage(bad, refundableCents(target)));
    }
  }

  if (input.occurredOn) {
    if (!isCalendarDate(input.occurredOn)) throw badRequest('That is not a real date');
    if (input.occurredOn > dateOf(new Date(), family.timezone)) {
      throw badRequest('You cannot date an entry in the future');
    }
  }

  const accountId = input.accountId ?? entry.account_id;
  if (!c.get('accounts').some((a) => a.id === accountId)) throw badRequest('No such account');

  const period = input.occurredOn ? periodFromDate(input.occurredOn) : entry.period;
  const occurredAt = input.occurredOn
    ? occurredAtFor(input.occurredOn, family.timezone)
    : entry.occurred_at;

  const categoryId = input.categoryId === undefined ? entry.category_id : input.categoryId;
  const cardId = input.cardId === undefined ? entry.card_id : input.cardId;
  const note = input.note === undefined ? entry.note : input.note;

  const before = {
    accountId: entry.account_id, amountCents: entry.amount_cents,
    period: entry.period, occurredAt: entry.occurred_at,
    categoryId: entry.category_id, cardId: entry.card_id, note: entry.note,
  };
  const after = { accountId, amountCents, period, occurredAt, categoryId, cardId, note };

  if (mode === 'direct') {
    // The window is re-checked in the UPDATE itself, so an entry that ages out
    // between the read above and this write is not quietly rewritten.
    const cutoff = new Date(Date.now() - family.editWindowHours * 3_600_000).toISOString();
    const res = await c.env.DB
      .prepare(
        `UPDATE ledger_entries
            SET account_id = ?, amount_cents = ?, period = ?, category_id = ?,
                card_id = ?, note = ?, occurred_at = ?
          WHERE id = ? AND created_at > ?`,
      )
      .bind(accountId, amountCents, period, categoryId, cardId, note, occurredAt, entry.id, cutoff)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      throw conflict('That entry is no longer editable — save it as a correction instead');
    }

    // Nothing survives in the ledger itself, so the audit log is the only record
    // that this changed. It is not optional here.
    await auditInsert(c.env.DB, actor.id, 'ledger.edit.direct',
      { type: 'ledger_entry', id: entry.id },
      { before, after, reason: input.reason ?? null }).run();

    return c.json({ ok: true, mode });
  }

  await c.env.DB.batch([
    ledgerInsert(c.env.DB, {
      accountId: entry.account_id,
      actorUserId: actor.id,
      type: 'void',
      amountCents: -entry.amount_cents,
      period: entry.period,
      voidsEntryId: entry.id,
      note: input.reason!.trim(),
      occurredAt: entry.occurred_at,
      createdBy: actor.id,
    }),
    ledgerInsert(c.env.DB, {
      accountId,
      actorUserId: actor.id,
      type,
      amountCents,
      period,
      categoryId,
      cardId,
      spendCheckId: entry.spend_check_id,
      refundsEntryId: entry.refunds_entry_id,
      note,
      occurredAt,
      createdBy: actor.id,
    }),
    auditInsert(c.env.DB, actor.id, 'ledger.edit.correction',
      { type: 'ledger_entry', id: entry.id },
      { before, after, reason: input.reason }),
  ]);

  return c.json({ ok: true, mode });
});

/**
 * Remove an entry outright. Inside the window it is deleted; outside, the
 * caller must use the correction route so the reversal stays on the record.
 */
adminRoutes.delete('/ledger/:id', async (c) => {
  const entry = await c.env.DB
    .prepare('SELECT id, account_id, type, amount_cents, period, note, created_at FROM ledger_entries WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{
      id: string; account_id: string; type: string; amount_cents: number;
      period: string; note: string | null; created_at: string;
    }>();
  if (!entry) throw notFound('No such ledger entry');

  const type = entry.type as LedgerType;
  if (!canEditType(type)) throw conflict(whyNotEditable(type));
  if (blocksEditing(await getRefundedFor(c.env.DB, entry.id))) {
    throw conflict('This purchase has a return recorded against it — remove that first');
  }

  const family = c.get('family');
  if (!isWithinEditWindow(entry.created_at, family.editWindowHours)) {
    throw conflict('Too old to delete — remove it as a correction instead');
  }

  const cutoff = new Date(Date.now() - family.editWindowHours * 3_600_000).toISOString();
  const res = await c.env.DB
    .prepare('DELETE FROM ledger_entries WHERE id = ? AND created_at > ?')
    .bind(entry.id, cutoff)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    throw conflict('That entry is no longer editable — remove it as a correction instead');
  }

  await auditInsert(c.env.DB, c.get('user').id, 'ledger.delete',
    { type: 'ledger_entry', id: entry.id },
    { accountId: entry.account_id, amountCents: entry.amount_cents,
      period: entry.period, note: entry.note, closedAt: editWindowClosesAt(entry.created_at, family.editWindowHours) }).run();

  return c.json({ ok: true });
});


adminRoutes.get('/audit', async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT a.id, a.actor_user_id, a.action, a.target_type, a.target_id, a.detail_json,
              a.created_at, u.display_name AS actor_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.created_at DESC LIMIT 200`,
    )
    .all();
  return c.json({ entries: results });
});

adminRoutes.get('/export', async (c) => {
  const [ledger, checks, accounts, users] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM ledger_entries ORDER BY occurred_at').all(),
    c.env.DB.prepare('SELECT * FROM spend_checks ORDER BY created_at').all(),
    c.env.DB.prepare('SELECT * FROM accounts').all(),
    c.env.DB.prepare('SELECT id, display_name, email, role, status FROM users').all(),
  ]);

  if (c.req.query('format') === 'csv') {
    const header = 'id,account_id,type,amount_cents,period,occurred_at,note\n';
    const rows = (ledger.results as Record<string, unknown>[])
      .map((r) => [r.id, r.account_id, r.type, r.amount_cents, r.period, r.occurred_at,
        JSON.stringify(r.note ?? '')].join(','))
      .join('\n');
    return new Response(header + rows, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="budjo-ledger-${nowIso().slice(0, 10)}.csv"`,
      },
    });
  }

  return c.json({
    exportedAt: nowIso(),
    users: users.results,
    accounts: accounts.results,
    ledgerEntries: ledger.results,
    spendChecks: checks.results,
  });
});

/** Snapshot to R2 on demand, and list what snapshots exist. */
adminRoutes.post('/backup', async (c) => {
  if (!c.env.BACKUPS) {
    throw conflict('Backups are not switched on yet — R2 needs enabling on the account');
  }
  return c.json(await runBackup(c.env.DB, c.env.BACKUPS));
});

adminRoutes.get('/backups', async (c) => {
  if (!c.env.BACKUPS) return c.json({ enabled: false, snapshots: [] });
  const listed = await c.env.BACKUPS.list({ prefix: 'snapshots/' });
  return c.json({
    enabled: true,
    snapshots: listed.objects
      .map((o) => ({ key: o.key, size: o.size, uploadedAt: o.uploaded }))
      .sort((a, b) => (a.key < b.key ? 1 : -1)),
  });
});

/** Manual trigger, mostly for "the allocation didn't show up" moments. */
adminRoutes.post('/maintenance', async (c) => {
  const result = await runMaintenance(c.env.DB, c.get('family'));
  return c.json(result);
});
