import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../db/schema';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** An in-memory Postgres with the app's migrations applied. */
export async function testDb() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db;
}
