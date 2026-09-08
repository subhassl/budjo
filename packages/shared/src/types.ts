export type Role = 'admin' | 'member';
export type UserStatus = 'active' | 'disabled';
export type AccountKind = 'personal' | 'joint';

export type Decision = 'approved' | 'tight' | 'denied';
export type SpendCheckStatus = 'pending' | 'settled' | 'cancelled' | 'expired' | 'denied';

export type LedgerType =
  | 'allocation'
  | 'spend'
  | 'refund'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'advance'
  | 'advance_repayment'
  | 'void';

export type TransferStatus = 'pending' | 'approved' | 'declined' | 'expired';

export interface User {
  id: string;
  displayName: string;
  email: string | null;
  role: Role;
  status: UserStatus;
}

export interface Account {
  id: string;
  kind: AccountKind;
  ownerUserId: string | null;
  name: string;
  sortOrder: number;
  allowAdvance: boolean;
  maxAdvanceCents: number | null;
}

export interface AccountBalance {
  accountId: string;
  balanceCents: number;
  holdCents: number;
  availableCents: number;
}

export interface AccountSummary extends AccountBalance {
  account: Account;
  canSpend: boolean;
  period: string;
  allocatedCents: number;
  spentCents: number;
  carriedInCents: number;
  outstandingAdvanceCents: number;
  nextPeriodOpeningCents: number;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
  countsAgainstBudget: boolean;
}

export interface Card {
  id: string;
  name: string;
  issuer: string | null;
  last4: string | null;
  rewardNote: string | null;
  statementCloseDay: number | null;
  dueDay: number | null;
}

export interface SpendCheck {
  id: string;
  accountId: string;
  actorUserId: string;
  estimatedCents: number;
  categoryId: string | null;
  cardId: string | null;
  merchant: string | null;
  note: string | null;
  decision: Decision;
  decisionAvailableCents: number;
  status: SpendCheckStatus;
  actualCents: number | null;
  overdrawn: boolean;
  expiresAt: string;
  createdAt: string;
  settledAt: string | null;
}

/** What a denied check offers instead. Only remedies open to this user appear. */
export interface Remedy {
  kind: 'switch_account' | 'request_transfer' | 'advance';
  label: string;
  accountId?: string;
  availableCents?: number;
  shortfallCents: number;
}

export interface DecisionResult {
  decision: Decision;
  availableCents: number;
  remainingCents: number;
  shortfallCents: number;
}

export interface LedgerEntry {
  id: string;
  accountId: string;
  actorUserId: string | null;
  type: LedgerType;
  amountCents: number;
  period: string;
  categoryId: string | null;
  cardId: string | null;
  spendCheckId: string | null;
  counterpartyAccountId: string | null;
  /** Set on a correction; points at the entry it reverses. */
  voidsEntryId: string | null;
  /** Set on a refund; points at the purchase it returns. */
  refundsEntryId: string | null;
  /** On a spend, how much has been returned against it so far. */
  refundedCents?: number;
  note: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface FamilySettings {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  reserveThresholdCents: number;
  holdTtlHours: number;
  /** Hours after creation during which an entry can be fixed in place. */
  editWindowHours: number;
}

export interface MeResponse {
  user: User;
  family: FamilySettings;
  accounts: Account[];
  spendableAccountIds: string[];
}
