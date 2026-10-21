import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const defaultDataDir = fileURLToPath(new URL('../../../data', import.meta.url));

/** Treat empty values in .env as unset. */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const Env = z.object({
  PORT: unsetIfEmpty(z.coerce.number().int().positive().default(8787)),
  // Optional until the Supabase connection string is available; only database code needs it.
  DATABASE_URL: unsetIfEmpty(z.string().optional()),
  /** Scraped data and processed models (gitignored). */
  DATA_DIR: unsetIfEmpty(z.string().default(defaultDataDir)),
});

export type Config = {
  port: number;
  databaseUrl: string | undefined;
  dataDir: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return {
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    dataDir: parsed.data.DATA_DIR,
  };
}
