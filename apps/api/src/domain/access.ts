import type { Account, Role, User } from '@budjo/shared';

/**
 * Role and account access are two different things (DESIGN.md §3.1):
 *
 *   role   — what settings you may change
 *   access — whose money you may spend
 *
 * Keeping them separate is what lets a parent administer a child's allowance
 * (see it, adjust it, cap it) without being able to spend from it. Admin is
 * not a master key to other people's money.
 */

export class AccessError extends Error {
  readonly status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = 'AccessError';
    this.status = status;
  }
}

export interface AccessContext {
  user: Pick<User, 'id' | 'role' | 'status'>;
  accounts: Account[];
  /** account_access rows for this user. */
  accessibleAccountIds: readonly string[];
}

export function isAdmin(user: Pick<User, 'role' | 'status'>): boolean {
  return user.status === 'active' && user.role === 'admin';
}

export function isActive(user: Pick<User, 'status'>): boolean {
  return user.status === 'active';
}

function findAccount(ctx: AccessContext, accountId: string): Account | undefined {
  return ctx.accounts.find((a) => a.id === accountId);
}

/**
 * Spending requires an explicit access row — or being the owner of a personal
 * account, which is belt-and-braces in case the row is ever missing. Notably
 * this is *not* implied by the admin role.
 */
export function canSpendFromAccount(ctx: AccessContext, accountId: string): boolean {
  if (!isActive(ctx.user)) return false;
  const account = findAccount(ctx, accountId);
  if (!account) return false;
  if (ctx.accessibleAccountIds.includes(accountId)) return true;
  return account.kind === 'personal' && account.ownerUserId === ctx.user.id;
}

/** Admins see every account; members see only what they can spend from. */
export function canViewAccount(ctx: AccessContext, accountId: string): boolean {
  if (!isActive(ctx.user)) return false;
  if (!findAccount(ctx, accountId)) return false;
  if (isAdmin(ctx.user)) return true;
  return canSpendFromAccount(ctx, accountId);
}

export function visibleAccounts(ctx: AccessContext): Account[] {
  return ctx.accounts.filter((a) => canViewAccount(ctx, a.id));
}

export function spendableAccounts(ctx: AccessContext): Account[] {
  return ctx.accounts.filter((a) => canSpendFromAccount(ctx, a.id));
}

/**
 * Money never leaves the joint pot into a personal balance (DESIGN.md §2.1),
 * so transfers may only originate from a personal account you own. That rule
 * lives here rather than in a policy flag: the operation simply doesn't exist.
 */
export function canTransferFrom(ctx: AccessContext, accountId: string): boolean {
  if (!isActive(ctx.user)) return false;
  const account = findAccount(ctx, accountId);
  if (!account) return false;
  return account.kind === 'personal' && account.ownerUserId === ctx.user.id;
}

export function canTransferTo(ctx: AccessContext, fromAccountId: string, toAccountId: string): boolean {
  if (fromAccountId === toAccountId) return false;
  return Boolean(findAccount(ctx, toAccountId));
}

/** Borrowing forward is opt-in per account, and off by default for kids. */
export function canTakeAdvance(ctx: AccessContext, accountId: string): boolean {
  const account = findAccount(ctx, accountId);
  if (!account) return false;
  return canSpendFromAccount(ctx, accountId) && account.allowAdvance;
}

export function canApproveTransferRequests(user: Pick<User, 'role' | 'status'>): boolean {
  return isAdmin(user);
}

// --- assertions: routes call these rather than re-implementing the rules ---

export function assertAdmin(user: Pick<User, 'role' | 'status'>): void {
  if (!isAdmin(user)) throw new AccessError('Admins only');
}

export function assertCanSpend(ctx: AccessContext, accountId: string): void {
  if (!canSpendFromAccount(ctx, accountId)) {
    throw new AccessError('You cannot spend from that account');
  }
}

export function assertCanView(ctx: AccessContext, accountId: string): void {
  if (!canViewAccount(ctx, accountId)) {
    throw new AccessError('No such account', 404);
  }
}

export function assertCanTransfer(ctx: AccessContext, from: string, to: string): void {
  if (!canTransferFrom(ctx, from)) {
    throw new AccessError('You can only transfer out of your own personal account');
  }
  if (!canTransferTo(ctx, from, to)) {
    throw new AccessError('Invalid transfer destination');
  }
}

export function assertCanAdvance(ctx: AccessContext, accountId: string): void {
  if (!canSpendFromAccount(ctx, accountId)) {
    throw new AccessError('You cannot spend from that account');
  }
  if (!canTakeAdvance(ctx, accountId)) {
    throw new AccessError('Advances are turned off for this account');
  }
}

export function roleLabel(role: Role): string {
  return role === 'admin' ? 'Admin' : 'Member';
}
