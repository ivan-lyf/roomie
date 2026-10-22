import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/** Any Postgres driver: postgres.js against Supabase, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Add the Supabase connection string to .env.');
  }
  // Supabase's transaction pooler doesn't support prepared statements.
  const client = postgres(databaseUrl, { prepare: false });
  return drizzle(client, { schema });
}

