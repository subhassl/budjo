import { Hono } from 'hono';
import type { AppEnv, Env } from './env';
import { AccessError } from './domain/access';
import { HttpError } from './lib/http';
import { requireUser } from './middleware/auth';
import { accountRoutes } from './routes/accounts';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { ledgerRoutes } from './routes/ledger';
import { moneyRoutes } from './routes/money';
import { spendCheckRoutes } from './routes/spendChecks';
import { getFamily } from './db/repo';
import { runMaintenance } from './services/maintenance';

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, code: err.code, details: err.details }, err.status as 400);
  }
  if (err instanceof AccessError) {
    return c.json({ error: err.message, code: 'forbidden' }, err.status as 403);
  }
  console.error('Unhandled error', err);
  return c.json({ error: 'Something went wrong', code: 'internal' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/auth', authRoutes);

// Everything past this point requires a signed-in user.
const api = new Hono<AppEnv>();
api.use('*', requireUser);
api.route('/', accountRoutes);
api.route('/', spendCheckRoutes);
api.route('/', ledgerRoutes);
api.route('/', moneyRoutes);
api.route('/admin', adminRoutes);
app.route('/api', api);

app.all('/api/*', (c) => c.json({ error: 'Not found', code: 'not_found' }, 404));

/**
 * Anything that isn't an API call is the PWA. Static files are served by the
 * assets binding; unknown paths return the SPA shell so client-side routes
 * survive a refresh.
 */
app.all('*', async (c) => {
  const url = new URL(c.req.url);
  const direct = await c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  if (direct.status !== 404) return direct;
  return c.env.ASSETS.fetch(new Request(new URL('/index.html', url.origin).toString()));
});

export default {
  fetch: app.fetch,

  /** Daily: allocate the month, repay due advances, expire stale holds. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const family = await getFamily(env.DB);
        const result = await runMaintenance(env.DB, family);
        console.log('maintenance', JSON.stringify(result));
      })(),
    );
  },
};
