#!/usr/bin/env node
/**
 * End-to-end smoke test against a LOCAL dev server.
 *
 * Exercises the real Worker and a real D1 database: allocation, holds,
 * settlement, denial and its remedies, transfers, advances, and every access
 * rule that matters once there is a child in the family.
 *
 * It mints a session row directly rather than performing a passkey ceremony,
 * which is why it refuses to run against anything but localhost.
 *
 *   npm run db:migrate:local && npm run seed:local
 *   npm run dev:api          # in another terminal
 *   node scripts/smoke.mjs
 */
import { SignJWT } from 'jose';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8787/api';
if (!BASE.startsWith('http://localhost')) throw new Error('smoke.mjs is local-only');

// Read the local dev secret rather than hardcoding one, so this works with
// whatever you put in .dev.vars and there is no secret checked into the repo.
const devVars = readFileSync('.dev.vars', 'utf8');
const match = devVars.match(/^\s*SESSION_SECRET\s*=\s*"?([^"\n]+)"?/m);
if (!match) throw new Error('No SESSION_SECRET in .dev.vars — copy .dev.vars.example first');
const SECRET = new TextEncoder().encode(match[1]);
const sql = (s) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'budjo', '--local', '--command', s, '-y'],
  { stdio: 'pipe' }).toString();

// Reset to a known state so the run is repeatable. Truncating and re-seeding
// (rather than deleting the D1 file) means this works while `wrangler dev` is
// holding the database open.
const TABLES = [
  'ledger_entries', 'spend_checks', 'advances', 'transfer_requests', 'balance_snapshots',
  'idempotency_keys', 'audit_log', 'allocation_rules', 'account_access', 'credentials',
  'sessions', 'invites', 'category_card_rules', 'categories', 'cards', 'accounts',
  'users', 'family',
];
console.log('Resetting the local database…');
sql(TABLES.map((t) => `DELETE FROM ${t};`).join(' '));
execFileSync('node', ['scripts/seed.mjs', '--local'], { stdio: 'pipe' });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

async function session(userId, sid) {
  const expires = new Date(Date.now() + 864e5).toISOString();
  sql(`INSERT OR REPLACE INTO sessions (id,user_id,expires_at,created_at) VALUES ('${sid}','${userId}','${expires}','${new Date().toISOString()}')`);
  const jwt = await new SignJWT({ sid }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId).setIssuedAt().setExpirationTime('1d').sign(SECRET);
  return `budjo_session=${jwt}`;
}

const call = async (cookie, path, method = 'GET', body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
};

const cookie = await session('usr_one', 'ses_test_one');

console.log('\n1. Identity and lazy allocation');
const me = await call(cookie, '/me');
ok('signed in as the seeded admin', me.body.user?.displayName === 'Adult One');
ok('sees all three accounts', me.body.accounts?.length === 3, JSON.stringify(me.body.accounts?.length));
ok('can spend from own + joint only', JSON.stringify(me.body.spendableAccountIds?.sort()) === '["acc_joint","acc_one"]',
   JSON.stringify(me.body.spendableAccountIds));

let accounts = (await call(cookie, '/accounts')).body.accounts;
const find = (list, id) => list.find((a) => a.accountId === id);
ok('allocation posted automatically ($200)', find(accounts, 'acc_one').balanceCents === 20000,
   `got ${find(accounts, 'acc_one').balanceCents}`);
ok('joint allocated too', find(accounts, 'acc_joint').balanceCents === 20000);
ok('carried in is zero in month one', find(accounts, 'acc_one').carriedInCents === 0);

console.log('\n2. Spend check, hold, settle');
const check1 = await call(cookie, '/spend-checks', 'POST',
  { accountId: 'acc_one', estimatedCents: 5000, categoryId: 'cat_dining', cardId: 'crd_amex_gold' });
ok('approved', check1.body.result?.decision === 'approved', JSON.stringify(check1.body.result));
ok('reports what is left after', check1.body.result?.remainingCents === 15000);

accounts = (await call(cookie, '/accounts')).body.accounts;
ok('hold reduces available but not balance',
   find(accounts, 'acc_one').holdCents === 5000 && find(accounts, 'acc_one').availableCents === 15000);

const settled = await call(cookie, `/spend-checks/${check1.body.check.id}/settle`, 'POST', { actualCents: 5500 });
ok('settles at the actual amount, not the estimate', settled.body.check?.actualCents === 5500);
accounts = (await call(cookie, '/accounts')).body.accounts;
ok('balance reflects the actual', find(accounts, 'acc_one').balanceCents === 14500,
   `got ${find(accounts, 'acc_one').balanceCents}`);
ok('hold released', find(accounts, 'acc_one').holdCents === 0);
ok('spent total tracks the month', find(accounts, 'acc_one').spentCents === 5500);

console.log('\n3. The tight warning');
const tight = await call(cookie, '/spend-checks', 'POST', { accountId: 'acc_one', estimatedCents: 10500 });
ok('warns when it leaves under $50', tight.body.result?.decision === 'tight', JSON.stringify(tight.body.result));
await call(cookie, `/spend-checks/${tight.body.check.id}/cancel`, 'POST');
accounts = (await call(cookie, '/accounts')).body.accounts;
ok('cancelling releases the hold', find(accounts, 'acc_one').availableCents === 14500);

console.log('\n4. Denial and its remedies');
const denied = await call(cookie, '/spend-checks', 'POST',
  { accountId: 'acc_one', estimatedCents: 20000, categoryId: 'cat_shopping' });
ok('denied', denied.body.result?.decision === 'denied');
ok('reports the shortfall', denied.body.result?.shortfallCents === 5500);
const kinds = (denied.body.remedies ?? []).map((r) => r.kind);
ok('offers the joint pot', kinds.includes('switch_account'), JSON.stringify(kinds));
ok('offers an advance', kinds.includes('advance'), JSON.stringify(kinds));

const repriced = await call(cookie, `/spend-checks/${denied.body.check.id}/reprice`, 'POST',
  { accountId: 'acc_joint' });
// Spending exactly the joint balance leaves $0, which is under the reserve —
// so this is a 'tight' yes rather than a flat 'approved'. Either is a pass.
ok('switching to Joint gets it through', repriced.body.result?.decision !== 'denied',
   JSON.stringify(repriced.body.result));
await call(cookie, `/spend-checks/${repriced.body.check.id}/cancel`, 'POST');

console.log('\n5. Overdrawing settlement is always allowed');
const small = await call(cookie, '/spend-checks', 'POST', { accountId: 'acc_one', estimatedCents: 14000 });
const over = await call(cookie, `/spend-checks/${small.body.check.id}/settle`, 'POST', { actualCents: 16000 });
ok('settles above what was available', over.status === 200 && over.body.check?.actualCents === 16000,
   JSON.stringify(over.body).slice(0, 120));
ok('flags it as overdrawn', over.body.check?.overdrawn === true);
accounts = (await call(cookie, '/accounts')).body.accounts;
ok('balance goes negative and stays visible', find(accounts, 'acc_one').balanceCents === -1500,
   `got ${find(accounts, 'acc_one').balanceCents}`);

console.log('\n6. Transfers');
const badTransfer = await call(cookie, '/transfers', 'POST',
  { fromAccountId: 'acc_joint', toAccountId: 'acc_one', amountCents: 1000 });
ok('money cannot leave the joint pot', badTransfer.status === 403, `status ${badTransfer.status}`);

const notMine = await call(cookie, '/transfers', 'POST',
  { fromAccountId: 'acc_two', toAccountId: 'acc_one', amountCents: 1000 });
ok('cannot send from a spouse’s account', notMine.status === 403);

const topUp = await call(cookie, '/transfers', 'POST',
  { fromAccountId: 'acc_joint', toAccountId: 'acc_joint', amountCents: 1000 });
ok('cannot transfer to the same account', topUp.status === 403);

console.log('\n7. Advances');
const adv = await call(cookie, '/advances', 'POST', { accountId: 'acc_one', amountCents: 5000 });
ok('advance granted within the cap', adv.status === 200, JSON.stringify(adv.body));
accounts = (await call(cookie, '/accounts')).body.accounts;
ok('advance credits the balance now', find(accounts, 'acc_one').balanceCents === 3500,
   `got ${find(accounts, 'acc_one').balanceCents}`);
ok('next month shows the consequence', find(accounts, 'acc_one').nextPeriodOpeningCents === 18500,
   `got ${find(accounts, 'acc_one').nextPeriodOpeningCents}`);
const tooMuch = await call(cookie, '/advances', 'POST', { accountId: 'acc_one', amountCents: 20000 });
ok('advance beyond the cap refused', tooMuch.status === 409, `status ${tooMuch.status}`);

console.log('\n8. Adding a child, and what they cannot do');
const kid = await call(cookie, '/admin/members', 'POST',
  { displayName: 'Kid', role: 'member', monthlyAllocationCents: 5000, joinJointAccountIds: [], allowAdvance: false });
ok('member created with an invite code', kid.status === 201 && typeof kid.body.inviteCode === 'string',
   JSON.stringify(kid.body).slice(0, 120));

const kidCookie = await session(kid.body.userId, 'ses_test_kid');
const kidMe = await call(kidCookie, '/me');
ok('child sees only their own account', kidMe.body.accounts?.length === 1, JSON.stringify(kidMe.body.accounts?.length));
ok('child got their allocation', (await call(kidCookie, '/accounts')).body.accounts[0].balanceCents === 5000);

ok('child cannot spend from a parent’s account',
   (await call(kidCookie, '/spend-checks', 'POST', { accountId: 'acc_one', estimatedCents: 100 })).status === 403);
ok('child cannot spend from the joint pot',
   (await call(kidCookie, '/spend-checks', 'POST', { accountId: 'acc_joint', estimatedCents: 100 })).status === 403);
ok('child cannot read a parent’s ledger',
   (await call(kidCookie, '/ledger?account=acc_one')).status === 404);
ok('child cannot take an advance',
   (await call(kidCookie, '/advances', 'POST', { accountId: kid.body.accountId, amountCents: 100 })).status === 403);
ok('child cannot reach admin', (await call(kidCookie, '/admin/overview')).status === 403);
ok('child cannot post an adjustment',
   (await call(kidCookie, '/admin/adjustments', 'POST',
     { accountId: kid.body.accountId, amountCents: 100000, note: 'nice try' })).status === 403);
// Note: on a $50 allowance the $50 family reserve makes almost everything
// 'tight'. That is a real UX wrinkle for small allowances, not a failure here.
const kidSpend = await call(kidCookie, '/spend-checks', 'POST',
  { accountId: kid.body.accountId, estimatedCents: 1000 });
ok('child CAN spend their own allowance',
   kidSpend.status === 200 && kidSpend.body.result?.decision !== 'denied',
   `${kidSpend.status} ${JSON.stringify(kidSpend.body.result)}`);

console.log('\n9. Admin can see a child’s account but not spend it');
const adminAccounts = (await call(cookie, '/accounts')).body.accounts;
const kidSummary = adminAccounts.find((a) => a.accountId === kid.body.accountId);
ok('parent sees the child’s balance', kidSummary?.balanceCents === 5000);
ok('parent cannot spend it', kidSummary?.canSpend === false);

console.log('\n10. Idempotency');
const key = crypto.randomUUID();
const one = await fetch(BASE + '/spend-checks', {
  method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify({ accountId: 'acc_joint', estimatedCents: 700 }),
});
const two = await fetch(BASE + '/spend-checks', {
  method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify({ accountId: 'acc_joint', estimatedCents: 700 }),
});
const b1 = await one.json(), b2 = await two.json();
ok('a retried request does not spend twice', b1.check.id === b2.check.id);
ok('the replay is marked', two.headers.get('Idempotent-Replay') === 'true');

console.log('\n11. Corrections never rewrite history');
const ledgerBefore = (await call(cookie, '/ledger?account=acc_one')).body.entries.length;
const spendEntry = (await call(cookie, '/ledger?account=acc_one')).body.entries.find((e) => e.type === 'spend');
const voided = await call(cookie, '/admin/void', 'POST',
  { ledgerEntryId: spendEntry.id, reason: 'wrong amount' });
ok('void accepted', voided.status === 200);
const ledgerAfter = (await call(cookie, '/ledger?account=acc_one')).body.entries;
ok('original entry still present', ledgerAfter.some((e) => e.id === spendEntry.id));
ok('a correcting entry was added', ledgerAfter.length === ledgerBefore + 1);
ok('voiding twice is refused',
   (await call(cookie, '/admin/void', 'POST', { ledgerEntryId: spendEntry.id, reason: 'again' })).status === 409);

console.log('\n12. Changing an allocation mid-month');
const kidAcct = kid.body.accountId;
const period = (await call(cookie, '/accounts')).body.accounts[0].period;
const before = (await call(cookie, '/accounts')).body.accounts
  .find((a) => a.accountId === kidAcct).balanceCents;
const raise = await call(cookie, '/admin/allocations', 'POST',
  { accountId: kidAcct, amountCents: 7500, effectiveFrom: period });
ok('raising an already-posted month posts an adjustment', raise.body.adjusted === true,
   JSON.stringify(raise.body));
const after = (await call(cookie, '/accounts')).body.accounts
  .find((a) => a.accountId === kidAcct).balanceCents;
ok('the balance reflects the new amount', after - before === 2500, `delta ${after - before}`);

console.log('\n13. Backdating a logged spend');
const future = await call(cookie, '/spends', 'POST',
  { accountId: 'acc_joint', estimatedCents: 500, occurredOn: '2099-01-01' });
ok('refuses a spend dated in the future', future.status === 400, `status ${future.status}`);

const badDate = await call(cookie, '/spends', 'POST',
  { accountId: 'acc_joint', estimatedCents: 500, occurredOn: '2026-02-30' });
ok('refuses a date that does not exist', badDate.status === 400, `status ${badDate.status}`);

const thisPeriod = (await call(cookie, '/accounts')).body.accounts[0].period;
const lastPeriod = (() => {
  const [y, m] = thisPeriod.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
})();
const backdated = `${lastPeriod}-15`;

const jointBefore = (await call(cookie, '/accounts')).body.accounts
  .find((a) => a.accountId === 'acc_joint');
const logged = await call(cookie, '/spends', 'POST',
  { accountId: 'acc_joint', estimatedCents: 1234, occurredOn: backdated, merchant: 'Last month' });
ok('accepts a spend dated last month', logged.status === 200 && logged.body.check?.status === 'settled',
   JSON.stringify(logged.body).slice(0, 120));

const jointAfter = (await call(cookie, '/accounts')).body.accounts
  .find((a) => a.accountId === 'acc_joint');
ok('the balance still moves', jointBefore.balanceCents - jointAfter.balanceCents === 1234,
   `delta ${jointBefore.balanceCents - jointAfter.balanceCents}`);
ok('but it does NOT count against this month’s spend total',
   jointAfter.spentCents === jointBefore.spentCents,
   `this month spent ${jointBefore.spentCents} -> ${jointAfter.spentCents}`);

const entry = (await call(cookie, '/ledger?account=acc_joint')).body.entries
  .find((e) => e.note === 'Last month');
ok('the entry is filed under the month it happened', entry?.period === lastPeriod,
   `period ${entry?.period}, expected ${lastPeriod}`);
ok('and dated to the day picked', entry?.occurredAt.slice(0, 10) === backdated,
   `occurredAt ${entry?.occurredAt}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
