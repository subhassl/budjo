# Budjo

Household spending limits that sit **above** the credit cards, not inside them.

Each person gets a monthly discretionary allowance plus a shared joint pot.
Before a discretionary purchase you enter the amount and get a yes/no; afterwards
you settle the real amount. Unspent money carries forward forever.

See [DESIGN.md](./DESIGN.md) for why it works the way it does.

**Phase 1 is implemented**: passkey sign-in, roles and access enforcement, three
accounts, monthly allocation, spend checks with holds and settlement, denial
remedies, direct transfers, advances, history, and the admin panel.

---

## Stack

| | |
|---|---|
| Runtime | Cloudflare Workers (one Worker serves the API *and* the PWA) |
| Database | Cloudflare D1 (SQLite), plain SQL migrations |
| API | Hono + Zod |
| Frontend | React 19 + Vite + Tailwind 4 + TanStack Query |
| Auth | WebAuthn passkeys (`@simplewebauthn`), no passwords anywhere |

Running cost at two users: **$0/month** on Cloudflare's free tier.

---

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars     # then put a long random string in it
npm run db:migrate:local
npm run seed:local -- --user1 "Your name" --user2 "Their name"
npm run build                       # once, so the Worker has assets to serve
```

Then, in two terminals:

```bash
npm run dev:api                     # Worker + D1 on :8787
```

```bash
npm run dev                         # Vite on :5173, proxying /api to :8787
```

Open http://localhost:5173, pick your name, and register a passkey.

### Tests

```bash
npm test                            # 77 unit tests: ledger maths + access rules
node scripts/smoke.mjs              # 50 end-to-end checks against a local dev server
```

The smoke test needs `npm run dev:api` running. It resets and re-seeds the local
database itself, so it is repeatable. It mints a session directly instead of
doing a passkey ceremony, which is why it refuses to run against anything but
localhost.

---

## Deploying

```bash
npx wrangler login
npx wrangler d1 create budjo                    # copy database_id into wrangler.toml
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
npm run db:migrate                              # --remote
npm run seed -- --user1 "Your name" --user2 "Their name"
npm run deploy
```

Open the `*.workers.dev` URL. Whoever opens it first picks their name and
registers a passkey; that first-run claim closes permanently once any passkey
exists. The second person joins with an invite code generated in **Admin →
People → Invite code**.

### Two things worth knowing before you deploy

1. **Passkeys are bound to the domain.** If you start on `budjo.<you>.workers.dev`
   and later move to a custom domain, everyone re-registers their passkey. If you
   intend to buy a domain, attach it *before* you register passkeys.
2. **Set up backups.** This is a financial record. `Admin → Data → Export` gives
   you CSV and JSON; the scheduled R2 backup is Phase 2, so until then export
   occasionally.

---

## Layout

```
apps/api/src/
  domain/        pure logic, exhaustively tested — decision, access, allocation
  services/      the write flows — spend checks, transfers, advances, maintenance
  routes/        HTTP; no business rules live here
  db/            SQL queries and row mapping
apps/web/src/
  routes/        Home, SpendCheck, Pending, History, Admin, Settings, Login
  lib/           API client and TanStack Query hooks
packages/shared/ money and period helpers, Zod schemas, shared types
migrations/      plain SQL, applied with wrangler
scripts/         seed.mjs, smoke.mjs
```

The rule the codebase follows: **all money is signed integer cents**, and the
ledger is append-only — corrections are new entries that point at what they
reverse, never edits.
