import type { Account, FamilySettings, User } from '@budjo/shared';
import type { AccessContext } from './domain/access';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  APP_NAME?: string;
}

export interface Variables {
  user: User;
  family: FamilySettings;
  accounts: Account[];
  access: AccessContext;
  sessionId: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
