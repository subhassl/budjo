#!/usr/bin/env node
/**
 * Seeds a Budjo database: one family, two adult admins, three accounts
 * (two personal + the joint pot), the starting allocations, and the categories
 * and cards from DESIGN.md.
 *
 * Safe to re-run: every insert is INSERT OR IGNORE against fixed ids, so this
 * will not duplicate anything or overwrite amounts you have since changed in
 * the admin panel.
 *
 *   node scripts/seed.mjs --local
 *   node scripts/seed.mjs --remote --user1 "Ada" --user2 "Rae"
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const remote = args.includes('--remote');

const USER1 = flag('user1', 'Adult One');
const USER2 = flag('user2', 'Adult Two');
// The account label is what the home screen shows above the balance, so it
// defaults to a first name rather than the full one. Override with --account1/2.
const firstName = (full) => full.trim().split(/\s+/)[0];
const ACCOUNT1 = flag('account1', firstName(USER1));
const ACCOUNT2 = flag('account2', firstName(USER2));
const PERSONAL_CENTS = Number(flag('personal', '20000'));
const JOINT_CENTS = Number(flag('joint', '20000'));
const TIMEZONE = flag('timezone', 'America/Chicago');

const now = new Date().toISOString();
const period = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit' })
  .formatToParts(new Date())
  .reduce((acc, p) => (p.type === 'year' ? { ...acc, y: p.value } : p.type === 'month' ? { ...acc, m: p.value } : acc), {});
const PERIOD = `${period.y}-${period.m}`;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const categories = [
  ['cat_dining', 'Dining out', '🍽', 10],
  ['cat_shopping', 'Shopping', '🛍', 20],
  ['cat_entertainment', 'Entertainment', '🎬', 30],
  ['cat_travel', 'Travel', '✈️', 40],
  ['cat_gifts', 'Gifts', '🎁', 50],
  ['cat_hobbies', 'Hobbies', '🎸', 60],
  ['cat_other', 'Other', '•', 70],
];

const cards = [
  ['crd_robinhood', 'Robinhood Gold', 'Robinhood', '3% on everything', 10],
  ['crd_amex_gold', 'Amex Gold', 'American Express', '4x dining', 20],
  ['crd_amazon', 'Amazon Store Card', 'Synchrony', '5% at Amazon', 30],
  ['crd_target', 'Target RedCard', 'TD Bank', '5% at Target', 40],
  ['crd_macys', "Macy's", "Macy's", 'Store rewards', 50],
  ['crd_travel', 'Travel card', null, 'Travel rewards', 60],
];

// Which card we mean to reach for, per category — the nudge that made this
// project worth building in the first place.
const cardRules = [
  ['cat_dining', 'crd_amex_gold'],
  ['cat_shopping', 'crd_robinhood'],
  ['cat_entertainment', 'crd_robinhood'],
  ['cat_travel', 'crd_travel'],
  ['cat_gifts', 'crd_robinhood'],
  ['cat_hobbies', 'crd_robinhood'],
];

const lines = [
  `INSERT OR IGNORE INTO family (id, name, timezone, currency, reserve_threshold_cents, hold_ttl_hours, created_at)
   VALUES ('fam_main', 'Home', ${q(TIMEZONE)}, 'USD', 5000, 48, ${q(now)});`,

  `INSERT OR IGNORE INTO users (id, family_id, display_name, email, role, status, created_at)
   VALUES ('usr_one', 'fam_main', ${q(USER1)}, NULL, 'admin', 'active', ${q(now)});`,
  `INSERT OR IGNORE INTO users (id, family_id, display_name, email, role, status, created_at)
   VALUES ('usr_two', 'fam_main', ${q(USER2)}, NULL, 'admin', 'active', ${q(now)});`,

  `INSERT OR IGNORE INTO accounts (id, family_id, kind, owner_user_id, name, sort_order, allow_advance, max_advance_cents)
   VALUES ('acc_one', 'fam_main', 'personal', 'usr_one', ${q(ACCOUNT1)}, 10, 1, NULL);`,
  `INSERT OR IGNORE INTO accounts (id, family_id, kind, owner_user_id, name, sort_order, allow_advance, max_advance_cents)
   VALUES ('acc_two', 'fam_main', 'personal', 'usr_two', ${q(ACCOUNT2)}, 20, 1, NULL);`,
  `INSERT OR IGNORE INTO accounts (id, family_id, kind, owner_user_id, name, sort_order, allow_advance, max_advance_cents)
   VALUES ('acc_joint', 'fam_main', 'joint', NULL, 'Joint', 30, 1, NULL);`,

  `INSERT OR IGNORE INTO account_access (account_id, user_id, created_at) VALUES ('acc_one', 'usr_one', ${q(now)});`,
  `INSERT OR IGNORE INTO account_access (account_id, user_id, created_at) VALUES ('acc_two', 'usr_two', ${q(now)});`,
  `INSERT OR IGNORE INTO account_access (account_id, user_id, created_at) VALUES ('acc_joint', 'usr_one', ${q(now)});`,
  `INSERT OR IGNORE INTO account_access (account_id, user_id, created_at) VALUES ('acc_joint', 'usr_two', ${q(now)});`,

  `INSERT OR IGNORE INTO allocation_rules (id, account_id, amount_cents, effective_from, created_at)
   VALUES ('alr_one', 'acc_one', ${PERSONAL_CENTS}, ${q(PERIOD)}, ${q(now)});`,
  `INSERT OR IGNORE INTO allocation_rules (id, account_id, amount_cents, effective_from, created_at)
   VALUES ('alr_two', 'acc_two', ${PERSONAL_CENTS}, ${q(PERIOD)}, ${q(now)});`,
  `INSERT OR IGNORE INTO allocation_rules (id, account_id, amount_cents, effective_from, created_at)
   VALUES ('alr_joint', 'acc_joint', ${JOINT_CENTS}, ${q(PERIOD)}, ${q(now)});`,

  ...categories.map(([id, name, icon, sort]) =>
    `INSERT OR IGNORE INTO categories (id, family_id, name, icon, sort_order, counts_against_budget)
     VALUES (${q(id)}, 'fam_main', ${q(name)}, ${q(icon)}, ${sort}, 1);`),

  ...cards.map(([id, name, issuer, reward, sort]) =>
    `INSERT OR IGNORE INTO cards (id, family_id, name, issuer, last4, reward_note, statement_close_day, due_day, sort_order)
     VALUES (${q(id)}, 'fam_main', ${q(name)}, ${issuer ? q(issuer) : 'NULL'}, NULL, ${q(reward)}, NULL, NULL, ${sort});`),

  ...cardRules.map(([categoryId, cardId]) =>
    `INSERT OR IGNORE INTO category_card_rules (category_id, card_id, priority)
     VALUES (${q(categoryId)}, ${q(cardId)}, 1);`),
];

const file = 'seed.generated.sql';
writeFileSync(file, `${lines.join('\n\n')}\n`);

console.log(`Seeding ${remote ? 'remote' : 'local'} database…`);
console.log(`  ${USER1} (${ACCOUNT1}) and ${USER2} (${ACCOUNT2})`);
console.log(`  ${(PERSONAL_CENTS / 100).toFixed(2)} each + ${(JOINT_CENTS / 100).toFixed(2)} joint, from ${PERIOD}`);

execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'budjo', remote ? '--remote' : '--local', '--file', file, '-y'],
  { stdio: 'inherit' },
);

console.log(`
Done. Next:
  1. Start the app and open it.
  2. On the sign-in screen, pick a name to claim and register a passkey.
     (First-run claim is only offered while nobody has a passkey yet.)
  3. The other person signs in with an invite code you generate in Admin.
`);
