import type { Account, Card, Category, FamilySettings, LedgerEntry, SpendCheck, User } from '@budjo/shared';

/** Raw column shapes as they come back from D1, before camel-casing. */

export interface FamilyRow {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  reserve_threshold_cents: number;
  hold_ttl_hours: number;
}

export interface UserRow {
  id: string;
  family_id: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
}

export interface AccountRow {
  id: string;
  family_id: string;
  kind: 'personal' | 'joint';
  owner_user_id: string | null;
  name: string;
  sort_order: number;
  allow_advance: number;
  max_advance_cents: number | null;
  archived_at: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  counts_against_budget: number;
}

export interface CardRow {
  id: string;
  name: string;
  issuer: string | null;
  last4: string | null;
  reward_note: string | null;
  statement_close_day: number | null;
  due_day: number | null;
}

export interface SpendCheckRow {
  id: string;
  account_id: string;
  actor_user_id: string;
  estimated_cents: number;
  category_id: string | null;
  card_id: string | null;
  merchant: string | null;
  note: string | null;
  decision: 'approved' | 'tight' | 'denied';
  decision_available_cents: number;
  status: 'pending' | 'settled' | 'cancelled' | 'expired' | 'denied';
  actual_cents: number | null;
  overdrawn: number;
  expires_at: string;
  created_at: string;
  settled_at: string | null;
}

export interface LedgerRow {
  id: string;
  account_id: string;
  actor_user_id: string | null;
  type: LedgerEntry['type'];
  amount_cents: number;
  period: string;
  category_id: string | null;
  card_id: string | null;
  spend_check_id: string | null;
  counterparty_account_id: string | null;
  note: string | null;
  occurred_at: string;
  created_at: string;
}

export const toFamily = (r: FamilyRow): FamilySettings => ({
  id: r.id,
  name: r.name,
  timezone: r.timezone,
  currency: r.currency,
  reserveThresholdCents: r.reserve_threshold_cents,
  holdTtlHours: r.hold_ttl_hours,
});

export const toUser = (r: UserRow): User => ({
  id: r.id,
  displayName: r.display_name,
  email: r.email,
  role: r.role,
  status: r.status,
});

export const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  kind: r.kind,
  ownerUserId: r.owner_user_id,
  name: r.name,
  sortOrder: r.sort_order,
  allowAdvance: r.allow_advance === 1,
  maxAdvanceCents: r.max_advance_cents,
});

export const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  icon: r.icon,
  sortOrder: r.sort_order,
  countsAgainstBudget: r.counts_against_budget === 1,
});

export const toCard = (r: CardRow): Card => ({
  id: r.id,
  name: r.name,
  issuer: r.issuer,
  last4: r.last4,
  rewardNote: r.reward_note,
  statementCloseDay: r.statement_close_day,
  dueDay: r.due_day,
});

export const toSpendCheck = (r: SpendCheckRow): SpendCheck => ({
  id: r.id,
  accountId: r.account_id,
  actorUserId: r.actor_user_id,
  estimatedCents: r.estimated_cents,
  categoryId: r.category_id,
  cardId: r.card_id,
  merchant: r.merchant,
  note: r.note,
  decision: r.decision,
  decisionAvailableCents: r.decision_available_cents,
  status: r.status,
  actualCents: r.actual_cents,
  overdrawn: r.overdrawn === 1,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
  settledAt: r.settled_at,
});

export const toLedgerEntry = (r: LedgerRow): LedgerEntry => ({
  id: r.id,
  accountId: r.account_id,
  actorUserId: r.actor_user_id,
  type: r.type,
  amountCents: r.amount_cents,
  period: r.period,
  categoryId: r.category_id,
  cardId: r.card_id,
  spendCheckId: r.spend_check_id,
  counterpartyAccountId: r.counterparty_account_id,
  note: r.note,
  occurredAt: r.occurred_at,
  createdAt: r.created_at,
});
