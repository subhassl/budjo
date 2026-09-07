# Budjo — Design Document

**Status:** v0.4 — Phase 1 implemented; reconciled with the code
**Last updated:** 2026-09-07

---

## 1. Problem statement

We hold several credit cards, each optimized for a different merchant category:

| Card | Primary use |
|---|---|
| Robinhood Gold CC | General shopping |
| Amex Gold | Dining out |
| Amazon Store Card | Amazon |
| Target RedCard | Target |
| Macy's | Macy's |
| Travel card | Travel |

Because spending is spread across six-plus cards, **no single card's limit or statement acts as a spending control.** Issuer limits sit far above what we actually want to spend, and there's no way to express "we each get $200/month of discretionary spending" across all of them.

Budjo puts the limit *above* the cards instead of inside them. It tracks a per-person discretionary allowance plus a shared joint pot, and requires a **pre-spend check** before discretionary purchases: enter the amount first, get a yes/no, then go spend.

### Non-goals

- **No bank, card, or aggregator integration — ever.** No Plaid, no scraping, no email parsing. Everything is entered by hand; pre-approval is honor-based within the family. This is a permanent design decision, and it removes the entire credentials/PCI/OAuth surface from the project.
- Not a net-worth tracker, investment tracker, or bill-pay tool.
- Not multi-tenant SaaS. One family. Design for a handful of people and ~150 entries/month, not for scale.

### Success criteria

1. Before a discretionary purchase, anyone in the family gets a definitive yes/no in under 15 seconds on a phone.
2. At any moment we can answer "how much do I have left?" without opening any card app.
3. Unspent allowance rolls forward forever, with no month-end reconciliation work.
4. Running cost is $0–$5/month.

---

## 2. Core concepts

### 2.1 Money lives in accounts, not on people

| Account | Kind | Who can spend from it | Monthly allocation |
|---|---|---|---|
| Adult A | personal | Adult A | $200 |
| Adult B | personal | Adult B | $200 |
| Joint | joint | Both of us | $200 |

**Every amount here is editable in the admin panel**, per account, effective from a chosen month. $200/$200/$200 is a starting point, not a constant in the code.

The joint pot covers what we spend on *together* — date-night dinners, a shared Target run, a gift for someone else's family. Without it, every shared purchase becomes an argument about whose allowance it comes out of.

**Choosing the account is the user's call, not the app's.** There are no category→account defaults and no approval step: at spend time you tap *Mine* or *Joint* and that's the end of it. Any rule the app invented here would be wrong often enough to be annoying, and the honest answer is that only the person standing in the store knows whether this dinner is a joint dinner.

**Money does not flow back out of Joint.** There are no joint→personal transfers. Joint money is spent on joint things; it can't be extracted into a private balance. This removes a whole category of "who took from the shared pot?" and needs no approval mechanism to enforce, since the operation simply doesn't exist.

### 2.2 The allowance is a balance, not a monthly reset

Each account is an **append-only ledger**. There is no "monthly budget that resets."

- On the 1st of each month, an `allocation` entry of +$200 is appended to each account's ledger.
- Every discretionary purchase appends a `spend` entry (negative).
- **Balance = sum of all entries, from the beginning of time.**

Carry-forward isn't a feature — it's a consequence of never resetting. Saving $50 in March and $80 in April means May opens at $330 rather than $200. This naturally supports saving up for something large, which is the behavior we most want to encourage.

### 2.3 Pre-approval as a first-class object: the Spend Check

A **Spend Check** is created *before* money is spent:

```
                                  ┌──────────── settle(actual) ───────► SETTLED
  create(amount) ──► PENDING ─────┼──────────── cancel() ─────────────► CANCELLED
       │                          └──────────── 48h elapsed ──────────► EXPIRED
       ▼
  decision returned immediately: APPROVED | TIGHT | DENIED
```

- The **decision** is computed and returned synchronously at creation, and recorded.
- A `PENDING` check places a **hold** on the account, so two checks minutes apart can't both be approved against the same dollars.
- Holds **expire** (default 48h) so a forgotten check doesn't lock funds permanently.
- **Settlement** records the actual amount, which is nearly always different from the estimate (tax, tip, an extra item). Settling is the only step that writes a `spend` entry; the delta returns to, or comes out of, the balance.

This two-step design is the heart of the app. It matches real behavior: you know roughly what you're about to spend, and you find out afterward what you actually spent.

**Fast path:** small purchases get a one-tap "already spent it" flow that creates and settles in a single action. We shouldn't demand ceremony for a $6 coffee.

### 2.4 Decision rules

```
available = balance − sum(active holds on this account)

DENIED    if amount > available
TIGHT     if amount <= available but (available − amount) < reserve_threshold
APPROVED  otherwise
```

`reserve_threshold` (default $50, admin-editable) produces an amber "you can, but you'll be nearly out" warning rather than a hard stop.

**There is no override.** A DENIED check cannot be waved through. This is deliberate, and it puts real weight on the remedies below — if those are clumsy, the app gets abandoned the first time it's inconvenient, so they're designed as first-class flows rather than afterthoughts. When a check is denied, the verdict screen offers, inline:

1. **Spend from Joint instead** — one tap, re-runs the check against the joint balance. (Available only to users with joint access; see §3.)
2. **Ask for a transfer** — creates a `transfer_request` to another adult, pushes a notification, and they approve in one tap. On approval the money moves and the original check re-runs automatically. This is also the "Dad, can I have $20 more?" flow for kids.
3. **Take an advance against next month** — borrows forward, capped per account (admin-editable, default one month's allocation), repaid automatically out of the next allocation. The home screen shows "next month starts at $120" until it's repaid.

#### The one exception: settlement always succeeds

A check for $80 that settles at $95 **must be allowed to settle**, even if it drives the balance negative. The money is already spent; refusing to record it would only make the ledger wrong. So: *denial blocks new commitments, never the recording of reality.* A settlement that overdraws is flagged in history and surfaces on home until the balance recovers.

### 2.5 What counts against the budget

Only **discretionary** categories: eating out, shopping, entertainment, hobbies, gifts, travel extras. Groceries, rent, utilities, and insurance are out of scope — they aren't discretionary, and tracking them would turn this into a full budgeting app with a much larger data-entry burden.

Each category carries a `counts_against_budget` flag, so a category can be logged for reporting without touching an allowance if we ever want that.

### 2.6 Cards are metadata, and a recommendation engine

Every spend records **which card was used**. Cards have no limits in Budjo — they're tags. But recording them buys two things:

1. **Per-card monthly totals**, so when the Amex statement arrives we can check it against what we logged.
2. **Card suggestion:** picking a category auto-selects the right card ("Dining → Amex Gold, 4x points"). This nudges us toward the card we *meant* to use — a second, unstated reason this project exists.

Cards also store `statement_close_day` and `due_day`, so home can show "Amex closes in 3 days."

---

## 3. Users, roles, and access

The family starts as two adults, and **must be able to grow** — kids get accounts later, as non-admins. That makes the access model load-bearing rather than decorative, so it's defined explicitly rather than assumed.

### 3.1 Two separable ideas: role and access

| | Meaning |
|---|---|
| **Role** (`admin` / `member`) | What settings you can change |
| **Access** (`account_access` rows) | Whose money you can spend |

Keeping these separate is what makes kids work cleanly. A parent is an admin who can *see* a child's account and *adjust* its balance (logged), but has no `account_access` row on it and therefore cannot spend from it. Conversely a child has full spend rights over their own allowance and zero settings power. **Admin is not a master key to other people's money.**

### 3.2 Roles

| | Admin | Member |
|---|---|---|
| Spend from accounts they have access to | ✅ | ✅ |
| See own balance and history | ✅ | ✅ |
| See *all* accounts and history | ✅ | ❌ — only accounts they have access to |
| Request a transfer | ✅ | ✅ |
| Approve a transfer request | ✅ | ❌ |
| Take an advance | ✅ (if account allows) | Only if the account's `allow_advance` is on — **off by default** |
| Set allocation amounts, thresholds, caps | ✅ | ❌ |
| Manage categories, cards, accounts, users | ✅ | ❌ |
| Post adjustments, void entries | ✅ | ❌ |
| Export data, view audit log | ✅ | ❌ |

**Both adults are admins with full mutual visibility.** A two-person household shouldn't have a permissions bottleneck, and hiding a spouse's spending would defeat the purpose of a shared budget tool. Because either of us can change anything, **the audit log is the real accountability mechanism**: every allocation change, adjustment, and void records who did it and what changed.

### 3.3 Access rules

- **Personal account:** the owner has spend access. Nobody else ever does, admin or not.
- **Joint account:** spend access is an explicit list. Both adults are on it at launch; kids are not, unless deliberately added.
- **Visibility:** admins see every account. Members see only accounts they have spend access to — a child sees their own allowance and nothing else, and in particular not a sibling's.

### 3.4 Adding a person later

A single admin flow — *Add family member* — creates the user, their personal account, their allocation rule, optional joint access, and a single-use passkey invite code. Promoting a child to admin later is a one-field change, so the model doesn't need revisiting when they grow up.

The one thing worth deciding before kids exist rather than after is whether their unspent allowance carries forward like ours. Default: **yes** — the saving-up behavior is arguably the most valuable thing this app teaches. See [Q3](#152-non-blocking).

---

## 4. Data model

SQLite (Cloudflare D1). **All money is stored as signed integer cents.** No floats anywhere, ever. Currency is USD only.

```sql
family(
  id, name, timezone TEXT DEFAULT 'America/Los_Angeles',
  currency TEXT DEFAULT 'USD',
  reserve_threshold_cents INTEGER DEFAULT 5000,   -- admin-editable
  hold_ttl_hours INTEGER DEFAULT 48,              -- admin-editable
  created_at
)

users(
  id, family_id, display_name, email,
  role TEXT CHECK(role IN ('admin','member')),
  status TEXT CHECK(status IN ('active','disabled')),
  created_at
)

-- Money lives here, not on users.
accounts(
  id, family_id,
  kind TEXT CHECK(kind IN ('personal','joint')),
  owner_user_id NULL,              -- set for personal, NULL for joint
  name, sort_order,
  allow_advance INTEGER DEFAULT 1, -- admin-editable; 0 for kids by default
  max_advance_cents INTEGER NULL,  -- admin-editable; NULL = one month's allocation
  archived_at NULL
)

-- Who may SPEND from an account. Separate from role, on purpose (§3.1).
-- Personal accounts get one row (the owner); joint accounts get one per adult.
account_access(account_id, user_id, PRIMARY KEY(account_id, user_id))

-- Passkeys (WebAuthn). No password column, by design.
credentials(
  id, user_id, credential_id BLOB UNIQUE, public_key BLOB,
  counter INTEGER, transports TEXT, nickname, created_at, last_used_at
)

sessions(id, user_id, expires_at, created_at, user_agent, revoked_at)
invites(id, user_id, code_hash, expires_at, used_at, created_by)

-- Allocation amount over time. Changing an amount inserts a new row rather
-- than mutating, so history stays explainable.
allocation_rules(
  id, account_id, amount_cents INTEGER,
  effective_from TEXT,             -- 'YYYY-MM'
  effective_to TEXT NULL, created_by, created_at
)

categories(
  id, family_id, name, icon, sort_order,
  counts_against_budget INTEGER DEFAULT 1,
  archived_at NULL
)
-- No default_account_id: the user picks Mine vs Joint at spend time (§2.1).

cards(
  id, family_id, name, issuer, last4 NULL,
  reward_note TEXT,                -- '4x dining'
  statement_close_day INTEGER NULL, due_day INTEGER NULL,
  archived_at NULL
)

category_card_rules(category_id, card_id, priority INTEGER,
  PRIMARY KEY(category_id, priority))

spend_checks(
  id, account_id, actor_user_id,
  estimated_cents INTEGER NOT NULL,
  category_id, card_id NULL, merchant TEXT NULL, note TEXT NULL,
  decision TEXT CHECK(decision IN ('approved','tight','denied')),
  decision_available_cents INTEGER, -- snapshot of available at decision time
  status TEXT CHECK(status IN ('pending','settled','cancelled','expired')),
  actual_cents INTEGER NULL,
  overdrawn INTEGER DEFAULT 0,      -- settled above available
  expires_at, created_at, settled_at NULL
)

-- The source of truth. Append-only: corrections are new rows, never UPDATEs.
ledger_entries(
  id, account_id,
  actor_user_id,                    -- who did it (matters for joint)
  type TEXT CHECK(type IN (
    'allocation','spend','refund','adjustment',
    'transfer_in','transfer_out','advance','advance_repayment','void')),
  amount_cents INTEGER NOT NULL,    -- signed: allocation +, spend −
  period TEXT,                      -- 'YYYY-MM' this entry belongs to
  category_id NULL, card_id NULL,
  spend_check_id NULL,
  counterparty_account_id NULL,     -- transfers
  advance_id NULL,
  voids_entry_id NULL,              -- corrections point at what they reverse
  note TEXT, occurred_at, created_by, created_at
)
CREATE UNIQUE INDEX ux_alloc ON ledger_entries(account_id, period)
  WHERE type = 'allocation';
CREATE UNIQUE INDEX ux_advance_repay ON ledger_entries(advance_id)
  WHERE type = 'advance_repayment';
CREATE INDEX ix_ledger_acct_time ON ledger_entries(account_id, occurred_at DESC);

advances(
  id, account_id, amount_cents INTEGER,
  repay_period TEXT,                -- 'YYYY-MM' it comes out of
  repaid_at NULL, created_by, created_at
)

transfer_requests(
  id, from_account_id, to_account_id, requested_by_user_id,
  amount_cents INTEGER, note TEXT,
  status TEXT CHECK(status IN ('pending','approved','declined','expired')),
  spend_check_id NULL,              -- re-run this check on approval
  decided_by_user_id NULL, decided_at NULL, expires_at, created_at
)

balance_snapshots(account_id, period, closing_balance_cents, created_at,
  PRIMARY KEY(account_id, period))

idempotency_keys(key PRIMARY KEY, user_id, response_json, created_at)
audit_log(id, actor_user_id, action, target_type, target_id, detail_json, created_at)
```

### Why append-only

Editing a mistaken transaction rewrites history and makes "why is my balance this number?" unanswerable. Instead, a correction posts a `void` entry pointing at the original, plus a new correct entry. The UI presents it as an edit; the data keeps the trail. At a hundred-odd rows a month, the storage cost is irrelevant and the debuggability is worth a lot.

### Balance query

```sql
SELECT COALESCE(SUM(amount_cents), 0) FROM ledger_entries WHERE account_id = ?
```

With snapshots this becomes `snapshot + SUM(entries after snapshot)`. At our volume the naive sum is fine for years; snapshots are a listed optimization, not day-one work.

### Allowed transfers

| From → To | Allowed | Notes |
|---|---|---|
| personal → personal | ✅ | The denied-check remedy; needs the source owner's approval |
| personal → joint | ✅ | Contributing to a shared purchase |
| joint → personal | ❌ | Structurally absent (§2.1) — no approval flow needed |
| admin → any account | via `adjustment` | Not a transfer; logged, and doesn't move money out of anyone |

---

## 5. Monthly allocation

A Cloudflare **Cron Trigger** runs daily at 06:00 UTC and, for each active account, ensures an `allocation` entry exists for the current period in the family's timezone, then posts `advance_repayment` entries for any advances due that period. The unique indexes make both idempotent — running 30 times a month is harmless.

The same routine also runs **lazily on the first request of the day**, so allocations appear even if cron is misconfigured. Two independent paths to the same idempotent write; neither can double-allocate.

Missed months (app down for a while) are backfilled: the job walks from the last allocation period to the current one. A newly created account allocates from its first `effective_from` period, so adding a child mid-year doesn't retroactively grant them eleven months of allowance.

---

## 6. Architecture

### 6.1 Deployment target: Cloudflare

**Recommendation: Cloudflare Workers + D1 + Workers Static Assets.** One Worker serves both the API and the built PWA; one `wrangler deploy` ships everything.

| Option | Monthly cost | Notes |
|---|---|---|
| **Cloudflare Workers + D1** | **$0** | Free tier: 100k req/day, D1 5GB + 100k writes/day. We'll use ~200 req/day. Cron included. No idle pause. |
| Vercel Hobby + Neon free | $0 | Fine, but two vendors; Neon free tier suspends idle compute, adding a cold start |
| Supabase free | $0 | **Free projects pause after ~1 week of inactivity** — fatal for an app used in bursts |
| Fly.io smallest VM + volume | ~$2–4 | Real Postgres, more control, but we're paying for and operating a server |
| AWS Lambda + DynamoDB | ~$0 | Free tier covers it, but far more setup and IAM ceremony for no benefit here |

Cloudflare wins on: genuinely $0 at our volume, no idle-suspend, cron and static assets included, single vendor, fast edge PWA. The main constraint is D1's SQLite feature set, which is more than enough for this schema. The only real cost is a domain (~$10/yr, optional — `*.workers.dev` works).

**Backups:** a weekly cron exports D1 to **R2** (10GB free) as SQL, keeping 12 weeks, plus a manual "Export CSV/JSON" button in admin. This is a financial record; losing it to a bad migration is the worst realistic failure mode.

### 6.2 Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | Familiar, fast builds, best PWA plugin story |
| PWA | `vite-plugin-pwa` (Workbox) | Manifest, service worker, precaching, update prompt |
| Styling | Tailwind CSS | Fast iteration, dark mode, no design system to maintain |
| State/data | TanStack Query | Cache, optimistic updates, retry — most of "offline-ish" for free |
| API | Hono on Workers | Tiny, Workers-native, excellent TS types |
| Validation | Zod, shared client↔server | One schema, no drift |
| DB access | Plain SQL + typed row mappers | *Changed during Phase 1 from Drizzle: the migration files become the single source of truth for the schema, with no codegen step and no chance of the TS schema drifting from the SQL. The queries here are simple enough that an ORM was carrying its weight in neither direction.* |
| Auth | `@simplewebauthn/server` + `jose` | Passkeys; see below |
| Tests | Vitest (pure domain) + an end-to-end script against a local Worker | Ledger maths and access rules must be tested properly; see §11 |

### 6.3 Repo layout

```
Budjo/
├── DESIGN.md
├── package.json                 # npm workspaces
├── wrangler.toml
├── apps/
│   ├── web/                     # React PWA
│   │   ├── src/{routes,components,lib,hooks}
│   │   └── public/{manifest.webmanifest,icons/}
│   └── api/                     # Hono Worker (also serves the web build)
│       ├── src/{routes,domain,db,middleware}
│       ├── src/domain/ledger.ts # decision engine — pure, heavily tested
│       └── src/domain/access.ts # role + access rules — pure, heavily tested
├── packages/shared/             # zod schemas, money utils, shared types
└── migrations/
```

### 6.4 Auth: passkeys

Everyone is on a phone and wants to open the app and see a number without typing a password. **WebAuthn passkeys** (Face ID / Touch ID / Android biometric) fit perfectly: no passwords to store or leak, no email delivery dependency, one-tap login.

- Registration is via an **admin-generated single-use invite code**. There is no public sign-up.
- Each user can register multiple passkeys (phone + laptop).
- Session: signed JWT in an `HttpOnly; Secure; SameSite=Lax` cookie, 30-day sliding expiry, revocable server-side via the `sessions` table.
- Recovery: any admin can mint a fresh invite code for anyone, which covers device loss without a break-glass procedure.

Fallback if passkeys prove awkward on a kid's device: emailed magic link via Resend (free tier). Documented as plan B, not built day one.

---

## 7. API surface

REST, JSON, all under `/api`. All mutations accept an `Idempotency-Key` header. Every route is filtered by role *and* account access.

```
POST   /api/auth/passkey/register/{options,verify}
POST   /api/auth/passkey/login/{options,verify}
POST   /api/auth/logout
GET    /api/me                       → user, role, visible accounts, spendable accounts

GET    /api/accounts                 → visible accounts with balance / holds / available
GET    /api/accounts/:id/summary     → period allocated, spent, carried in,
                                       outstanding advances, next-month preview

POST   /api/spend-checks             → { decision, available, remedies, check }  ← core call
GET    /api/spend-checks?status=pending
POST   /api/spend-checks/:id/settle  { actual_cents }        # always succeeds
POST   /api/spend-checks/:id/cancel
POST   /api/spend-checks/:id/reprice { account_id }          # "spend from Joint instead"
POST   /api/spends                   → create+settle in one step (fast path)

POST   /api/transfer-requests        { from, to, amount, note, spend_check_id? }
POST   /api/transfer-requests/:id/{approve,decline}          # admins only
POST   /api/transfers                # direct move out of an account you own
POST   /api/advances                 { account_id, amount_cents }

GET    /api/ledger?account&from&to&category&card&cursor
POST   /api/refunds                  { ledger_entry_id, amount_cents }

GET    /api/reports/{by-card,by-category}?period
GET    /api/reports/trend?months=12
GET    /api/cards, /api/categories

# admin
POST   /api/admin/members            # user + personal account + allocation + invite
PATCH  /api/admin/users/:id          # role, status
CRUD   /api/admin/accounts           # incl. allow_advance, max_advance_cents
CRUD   /api/admin/account-access     # who can spend from Joint
POST   /api/admin/allocations        { account_id, amount_cents, effective_from }
PATCH  /api/admin/family             # reserve threshold, hold TTL, timezone
CRUD   /api/admin/{categories,cards,card-rules}
POST   /api/admin/adjustments        { account_id, amount_cents, note }
POST   /api/admin/void               { ledger_entry_id, reason }
GET    /api/admin/export?format=csv|json
GET    /api/admin/audit
```

### Concurrency

Spend-check creation and settlement run inside a D1 transaction that re-reads balance and active holds before writing, so two simultaneous checks can't both consume the last $50. This matters more than it looks: the **joint account is genuinely concurrent** — both of us can be standing in different stores spending from it at the same moment.

---

## 8. Screens

### Home (the screen that matters)

```
┌──────────────────────────────┐
│  Mine                        │
│      $337.20  available      │   ← huge, glanceable, color-coded
│      $357.20 balance · $20 held
│                              │
│  Joint          $186.50      │
│  Partner        $412.40      │   ← admins only
│  ─────────────────────────   │
│  September (mine)            │
│  Allocated       $200.00     │
│  Spent           $142.80     │
│  Carried in      $300.00     │
│                              │
│  ⚠ Amex closes in 3 days     │
│                              │
│  [  Can I spend?  ]          │   ← primary action, thumb-reachable
│  [  Log a spend   ]          │
└──────────────────────────────┘
```

A member (child) sees only their own card and the primary actions.

### Spend Check flow

1. **Amount** — big numeric keypad, no keyboard.
2. **Account** — segmented `Mine | Joint`, defaulting to last used. Hidden entirely for users with only one spendable account.
3. **Category** — icon grid, one tap. Sets the suggested card.
4. **Card** — pre-selected from the category rule, showing the reward reason.
5. **Verdict** — full-screen green/amber/red with the resulting balance.
   - On **DENIED**, remedies appear as buttons right here: *spend from Joint ($186 available)* · *ask your partner for $40* · *advance from next month*, each shown only when actually available to this user.
6. Confirm → hold placed → a settle prompt appears on home and as a notification.

### Other screens

- **Pending** — open checks, settle/cancel, hold time remaining.
- **History** — grouped by day, filterable by account/category/card/person, running balance shown.
- **Requests** — incoming transfer requests to approve or decline (admins).
- **Cards** — per-card month-to-date totals for statement reconciliation, close/due dates.
- **Insights** — 12-month trend, category breakdown, savings rate, biggest month.
- **Admin** — members and roles, accounts with allocation amounts / advance caps / joint access, family settings, categories, cards + rules, adjustments, void, export, audit log.
- **Settings** — theme, notifications, manage passkeys, install prompt.

---

## 9. PWA specifics

- `display: standalone`, portrait, maskable icons, themed splash; installable on iOS and Android.
- **Offline:** app shell precached. Balances and recent history cached in IndexedDB, shown with a "last synced 4:12pm" marker. Offline spend logging is queued with an idempotency key and replayed on reconnect.
  **Offline spend *checks* are explicitly provisional** — the server owns the balance, so an offline verdict is computed from the cached balance and clearly labeled. Doing otherwise would let two offline devices both approve the same dollars out of the joint pot.
- **Push notifications** (Web Push + VAPID, free): transfer requests, settle reminders, spend alerts, monthly allocation, statement-close reminders. On iOS, push requires the PWA to be installed to the home screen.
- Update flow: service worker prompts "New version available — reload."

---

## 10. Security & privacy

- No financial credentials, no card numbers (optional last-4 only), no bank connections. The blast radius of a breach is "someone learns we spent $42 on dinner."
- Passkeys mean no password database.
- Invite-only registration; Workers rate limiting on auth routes.
- **Access is enforced server-side on every route**, never by hiding UI. The member role only means something if the API refuses — this is the thing most likely to be got wrong once kids exist, so it's tested directly (§11).
- All money mutations write to `audit_log` with actor and before/after — the primary accountability mechanism, since all adults are admins.
- HTTPS only, `HttpOnly`/`Secure`/`SameSite` cookies, CSRF token on state-changing requests, strict CSP.

---

## 11. Testing

Two layers, both implemented.

**Unit (77 tests, `npm test`).** The decision engine, allocation planner, period arithmetic, money parsing and access rules are pure functions, and are tested exhaustively: carry-forward across months, holds, the tight/denied boundary to the cent, settlement above estimate, advance caps, backfilled allocations, mid-year allocation changes, accounts created mid-year, and month boundaries across timezone and DST.

Access rules get their own suite asserting the negative cases explicitly: a member cannot read another member's ledger or spend from Joint without an access row, cannot take an advance when `allow_advance` is off, and cannot reach any admin route — and an admin cannot spend from an account they lack access to.

**End-to-end (50 checks, `node scripts/smoke.mjs`).** Runs against a real Worker and a real D1 database: lazy allocation, holds, settlement, overdrawing settlement, denial and its remedies, transfers in every allowed and forbidden direction, advances and their cap, idempotent retries, voids, and every access rule above exercised over HTTP rather than in isolation.

---

## 12. Roadmap

**Phase 1 — Core (~2 weeks of evenings)**
Schema + migrations · passkey auth · roles + access enforcement · three accounts · monthly allocation cron · balance API · spend check create/settle/cancel with holds · "spend from Joint instead" · direct transfers · home · history · admin (members, allocations, caps, categories, cards) · deploy to Cloudflare

**Phase 2 — Daily-driver polish**
PWA install + offline shell · push notifications · transfer requests with approval · advances · card suggestion rules · per-card reconciliation view · refunds · CSV export · R2 backups

**Phase 3 — Nice to have**
Insights and trends · savings goals ("saving for a $900 trip") · recurring/planned spends · receipt photos in R2 · home-screen widget via shortcut · optional fixed-expense tracking · kid-friendly simplified home screen

> **Sequencing note:** transfer requests and advances are the *only* remedies for a denied check besides switching to Joint. Phase 1 therefore includes direct transfers (you move your own money to the other adult), leaving only the request/approval/notification layer for Phase 2. Without that, a denial where Joint is also empty would be a dead end.

---

## 13. Key decisions log

| Decision | Rationale |
|---|---|
| Money lives in accounts (personal + joint), not on users | Shared purchases don't force an argument about whose allowance it comes from |
| **Role and account access are separate concepts** | Lets a parent administer a child's allowance without being able to spend it |
| **User picks Mine vs Joint at spend time; no defaults, no approval** | Only the person in the store knows if this is a joint dinner; any rule would be wrong often enough to annoy |
| **No joint → personal transfers** | Removes "who took from the shared pot?" structurally, rather than policing it with an approval flow |
| Append-only ledger, balance derived | History stays explainable; "why is the number this?" is always answerable |
| Integer cents everywhere | Float money bugs are unacceptable and unavoidable |
| No monthly reset; carry-forward is emergent | Matches the actual goal (save up), removes month-end reconciliation |
| Holds on pending checks, with expiry | Prevents double-approval; expiry prevents permanent lockup |
| Estimate then settle actual | Real spending never matches the estimate |
| **No override on denial** | The limit means something. Requires the remedies to be genuinely good UX, or the app gets abandoned |
| **Settlement always succeeds, even overdrawing** | The money is already spent; refusing to record it only makes the ledger wrong |
| All tunable amounts live in the admin panel, not the code | Allocations, thresholds, and advance caps will change; editing them shouldn't need a deploy |
| Both adults admin, full mutual visibility; kids scoped to themselves | No bottleneck between spouses; audit log carries accountability |
| Discretionary spending only | Groceries/rent/utilities would multiply data entry for no control benefit |
| Cards as tags, not limits | Card limits are the problem, not the solution — the limit lives above the cards |
| Passkeys over passwords | Everyone's on a phone; fastest and safest option |
| Cloudflare Workers + D1 | Only option that's truly $0 with no idle-suspend, plus cron and static assets in one deploy |
| No bank/card API integration, ever | Honor system within the family; removes the largest complexity and risk surface |

---

## 14. Decided

- ✅ Separate personal allowances **plus** a joint pot — $200 / $200 / $200 to start, all editable in admin
- ✅ Discretionary spending only — no groceries, rent, utilities, or insurance
- ✅ Both adults are admins with full mutual visibility
- ✅ No override on a denied check — remedies are switch to Joint, request a transfer, or advance
- ✅ The user chooses Mine vs Joint at spend time; no category defaults, no approval
- ✅ No joint → personal transfers
- ✅ Advance cap is per-account and admin-editable
- ✅ Must support adding non-admin users (kids) later without a redesign

---

## 15. Open questions

### 15.1 Blocking (needed before deploy, not before I start building)

1. **Display names and email addresses** for both accounts. Placeholders work until then; seeding is a one-line change.

### 15.2 Non-blocking (defaults assumed; say the word to change)

2. **Kids' joint access** — assumed **no**: a child spends only from their own allowance. Toggleable per child in admin.
3. **Kids' carry-forward** — assumed **yes**, same as ours. It's arguably the most valuable habit the app teaches.
4. **Advances for kids** — assumed **off** (`allow_advance = 0`). Borrowing against next month is a sharper tool than a child needs, and the transfer-request flow already covers "can I have $20 more?"
5. **Personal → joint contributions** — assumed **allowed** (you top up Joint for a shared purchase). Say so if you'd rather Joint be fed only by its monthly allocation.
6. ~~**Timezone**~~ — decided: `America/Los_Angeles`. Both of us are in the Bay Area; this is what decides when the 1st of the month happens.
7. **Hold expiry** — 48 hours.
8. **Tight threshold** — amber warning when a purchase leaves under $50.
9. **Negative balances** — reachable only via advances or an overdrawing settlement, and carried forward. Any hard floor wanted?
9b. **The reserve threshold is family-wide, and that shows once kids exist.** A flat $50 "nearly out" warning is right for a $200 allowance and meaningless for a $50 one — every purchase reads as amber. Building this surfaced it. Options: make the threshold per-account, or express it as a percentage of the monthly allocation. Not worth changing until someone actually has a small allowance.
10. **Month-end moment** — a "you saved $X this month" notification on the 1st?
11. **Full card list** — the six above, plus anything else? Statement close and due dates for each?
12. **Category list** — starting set: Dining, Shopping, Entertainment, Travel, Gifts, Hobbies, Other. Add or remove?
13. **Domain** — custom domain (~$10/yr) or the free `budjo.<account>.workers.dev`?
14. **Starting balances** — begin all accounts at $0, or seed with current real balances?
