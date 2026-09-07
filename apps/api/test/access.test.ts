import { describe, expect, it } from 'vitest';
import type { Account, User } from '@budjo/shared';
import {
  AccessError, assertAdmin, assertCanAdvance, assertCanSpend, assertCanTransfer,
  canApproveTransferRequests, canSpendFromAccount, canTakeAdvance, canTransferFrom,
  canViewAccount, spendableAccounts, visibleAccounts, type AccessContext,
} from '../src/domain/access';

// The household the design is built around, plus the child it has to grow into.
const parentA: User = { id: 'u_a', displayName: 'Adult One', email: null, role: 'admin', status: 'active' };
const parentB: User = { id: 'u_b', displayName: 'Adult Two', email: null, role: 'admin', status: 'active' };
const kid: User = { id: 'u_k', displayName: 'Kid', email: null, role: 'member', status: 'active' };
const kid2: User = { id: 'u_k2', displayName: 'Kid Two', email: null, role: 'member', status: 'active' };

const account = (over: Partial<Account> & Pick<Account, 'id' | 'kind'>): Account => ({
  ownerUserId: null, name: over.id, sortOrder: 0, allowAdvance: true, maxAdvanceCents: null, ...over,
});

const accA = account({ id: 'a_a', kind: 'personal', ownerUserId: 'u_a' });
const accB = account({ id: 'a_b', kind: 'personal', ownerUserId: 'u_b' });
const accJ = account({ id: 'a_j', kind: 'joint' });
const accK = account({ id: 'a_k', kind: 'personal', ownerUserId: 'u_k', allowAdvance: false });
const accK2 = account({ id: 'a_k2', kind: 'personal', ownerUserId: 'u_k2', allowAdvance: false });
const accounts = [accA, accB, accJ, accK, accK2];

const ctxFor = (user: User, accessibleAccountIds: string[]): AccessContext =>
  ({ user, accounts, accessibleAccountIds });

const adultCtx = ctxFor(parentA, ['a_a', 'a_j']);
const wifeCtx = ctxFor(parentB, ['a_b', 'a_j']);
const kidCtx = ctxFor(kid, ['a_k']);

describe('spending access', () => {
  it('lets an adult spend from their own account and the joint pot', () => {
    expect(canSpendFromAccount(adultCtx, 'a_a')).toBe(true);
    expect(canSpendFromAccount(adultCtx, 'a_j')).toBe(true);
  });

  it('never lets one adult spend from the other’s personal account', () => {
    expect(canSpendFromAccount(adultCtx, 'a_b')).toBe(false);
  });

  // The whole point of separating role from access (DESIGN.md §3.1).
  it('does not let an admin spend from a child’s allowance', () => {
    expect(canSpendFromAccount(adultCtx, 'a_k')).toBe(false);
    expect(() => assertCanSpend(adultCtx, 'a_k')).toThrow(AccessError);
  });

  it('keeps a child out of the joint pot unless deliberately added', () => {
    expect(canSpendFromAccount(kidCtx, 'a_j')).toBe(false);
    expect(canSpendFromAccount(ctxFor(kid, ['a_k', 'a_j']), 'a_j')).toBe(true);
  });

  it('keeps one child out of another child’s allowance', () => {
    expect(canSpendFromAccount(kidCtx, 'a_k2')).toBe(false);
  });

  it('falls back to ownership if the access row is somehow missing', () => {
    expect(canSpendFromAccount(ctxFor(kid, []), 'a_k')).toBe(true);
  });

  it('refuses a disabled user everything', () => {
    const disabled = ctxFor({ ...parentA, status: 'disabled' }, ['a_a', 'a_j']);
    expect(canSpendFromAccount(disabled, 'a_a')).toBe(false);
    expect(canViewAccount(disabled, 'a_a')).toBe(false);
  });

  it('refuses an account that does not exist', () => {
    expect(canSpendFromAccount(adultCtx, 'a_nope')).toBe(false);
  });
});

describe('visibility', () => {
  it('shows admins every account', () => {
    expect(visibleAccounts(adultCtx).map((a) => a.id)).toEqual(['a_a', 'a_b', 'a_j', 'a_k', 'a_k2']);
  });

  it('shows a member only what they can spend from', () => {
    expect(visibleAccounts(kidCtx).map((a) => a.id)).toEqual(['a_k']);
  });

  it('does not show a child their sibling’s balance', () => {
    expect(canViewAccount(kidCtx, 'a_k2')).toBe(false);
    expect(canViewAccount(kidCtx, 'a_a')).toBe(false);
  });

  it('separates what an admin can see from what they can spend', () => {
    expect(canViewAccount(adultCtx, 'a_k')).toBe(true);
    expect(canSpendFromAccount(adultCtx, 'a_k')).toBe(false);
    expect(spendableAccounts(adultCtx).map((a) => a.id)).toEqual(['a_a', 'a_j']);
  });
});

describe('transfers', () => {
  it('lets you send from your own personal account', () => {
    expect(canTransferFrom(adultCtx, 'a_a')).toBe(true);
  });

  // Structurally absent rather than merely disallowed (DESIGN.md §2.1).
  it('never lets money leave the joint pot, even for an admin with access', () => {
    expect(canTransferFrom(adultCtx, 'a_j')).toBe(false);
    expect(() => assertCanTransfer(adultCtx, 'a_j', 'a_a')).toThrow(/your own personal account/);
  });

  it('refuses to send from someone else’s account', () => {
    expect(canTransferFrom(adultCtx, 'a_b')).toBe(false);
    expect(canTransferFrom(adultCtx, 'a_k')).toBe(false);
  });

  it('allows a top-up of the joint pot from a personal balance', () => {
    expect(() => assertCanTransfer(adultCtx, 'a_a', 'a_j')).not.toThrow();
  });

  it('allows sending to the other adult', () => {
    expect(() => assertCanTransfer(wifeCtx, 'a_b', 'a_a')).not.toThrow();
  });

  it('refuses a transfer to the same account', () => {
    expect(() => assertCanTransfer(adultCtx, 'a_a', 'a_a')).toThrow(AccessError);
  });

  it('refuses a transfer to an account that does not exist', () => {
    expect(() => assertCanTransfer(adultCtx, 'a_a', 'a_nope')).toThrow(AccessError);
  });
});

describe('advances', () => {
  it('allows an advance on an account that permits it', () => {
    expect(canTakeAdvance(adultCtx, 'a_a')).toBe(true);
  });

  it('is off for a child’s account by default', () => {
    expect(canTakeAdvance(kidCtx, 'a_k')).toBe(false);
    expect(() => assertCanAdvance(kidCtx, 'a_k')).toThrow(/Advances are turned off/);
  });

  it('still requires spend access, not just the flag', () => {
    expect(canTakeAdvance(adultCtx, 'a_b')).toBe(false);
    expect(() => assertCanAdvance(adultCtx, 'a_b')).toThrow(/cannot spend/);
  });
});

describe('admin-only actions', () => {
  it('lets both adults administer', () => {
    expect(() => assertAdmin(parentA)).not.toThrow();
    expect(() => assertAdmin(parentB)).not.toThrow();
  });

  it('refuses a member every admin route', () => {
    expect(() => assertAdmin(kid)).toThrow(AccessError);
    expect(canApproveTransferRequests(kid)).toBe(false);
  });

  it('refuses a disabled admin', () => {
    expect(() => assertAdmin({ ...parentA, status: 'disabled' })).toThrow(AccessError);
  });
});
