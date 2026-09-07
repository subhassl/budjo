import type { Account, FamilySettings, User } from '@budjo/shared';
import type { AccessContext } from './domain/access';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /**
   * Optional. Absent until R2 is enabled on the account and the binding is
   * uncommented in wrangler.toml. Deliberately optional so that a missing
   * bucket cannot break the cron that also posts the monthly allocation.
   */
  BACKUPS?: R2Bucket;
  SESSION_SECRET: string;
  APP_NAME?: string;
  /**
   * "production" everywhere except local development, where .dev.vars overrides
   * it. Nothing in the request itself can tell the two apart: configuring a
   * custom domain makes Miniflare rewrite the local URL and Host header to that
   * domain, so hostname sniffing reports budjo.theserenelifestyle.com even on
   * localhost. Defaults to production if unset, so a missing var fails closed.
   */
  APP_ENV?: string;
}

export const isProduction = (env: Pick<Env, 'APP_ENV'>): boolean =>
  (env.APP_ENV ?? 'production') === 'production';

export interface Variables {
  user: User;
  family: FamilySettings;
  accounts: Account[];
  access: AccessContext;
  sessionId: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
