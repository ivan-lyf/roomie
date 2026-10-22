import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { StorageConfig } from './storage';

const defaultDataDir = fileURLToPath(new URL('../../../data', import.meta.url));

/**
 * Google's current Flash model: the free tier has no Pro ones. `pnpm plans:eval --model` compares
 * others.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

/** Treat empty values in .env as unset. */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const optional = () => unsetIfEmpty(z.string().optional());

const Env = z.object({
  PORT: unsetIfEmpty(z.coerce.number().int().positive().default(8787)),
  // The catalog's database; the API and the catalog scripts need it.
  DATABASE_URL: optional(),
  /** Scraped data and processed models (gitignored). */
  DATA_DIR: unsetIfEmpty(z.string().default(defaultDataDir)),
  // File storage over the S3 protocol (Supabase Storage). Without it, models are served from disk.
  STORAGE_ENDPOINT: unsetIfEmpty(z.url().optional()),
  STORAGE_REGION: optional(),
  STORAGE_ACCESS_KEY_ID: optional(),
  STORAGE_SECRET_ACCESS_KEY: optional(),
  STORAGE_BUCKET: optional(),
  /** Uploaded plan images, in a second private bucket on the same service. */
  STORAGE_PLANS_BUCKET: unsetIfEmpty(z.string().default('plans')),
  // The vision model that reads uploaded plans: Gemini when there's a key, unless set to none.
  PLAN_READER: unsetIfEmpty(z.enum(['gemini', 'none']).optional()),
  GEMINI_API_KEY: optional(),
  GEMINI_MODEL: unsetIfEmpty(z.string().default(DEFAULT_GEMINI_MODEL)),
});

/** Which vision model reads plans, and how to reach it. */
export type ReaderConfig = { provider: 'gemini'; apiKey: string; model: string };

export type Config = {
  port: number;
  databaseUrl: string | undefined;
  dataDir: string;
  /** The models' bucket. */
  storage: StorageConfig | undefined;
  /** The plan images' bucket; without storage, plans are kept under DATA_DIR. */
  plansStorage: StorageConfig | undefined;
  /** Without one, plans are traced by hand. */
  reader: ReaderConfig | undefined;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const storage = storageConfig(e);
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    dataDir: e.DATA_DIR,
    storage,
    plansStorage: storage && { ...storage, bucket: e.STORAGE_PLANS_BUCKET },
    reader: readerConfig(e),
  };
}

function readerConfig(e: z.infer<typeof Env>): ReaderConfig | undefined {
  if (e.PLAN_READER === 'none') return undefined;
  if (!e.GEMINI_API_KEY) {
    if (e.PLAN_READER === 'gemini') {
      throw new Error('Invalid environment: PLAN_READER=gemini needs GEMINI_API_KEY');
    }
    return undefined;
  }
  return { provider: 'gemini', apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL };
}

/** All five STORAGE_* settings, or none: a partial set is almost always a typo. */
function storageConfig(e: z.infer<typeof Env>): StorageConfig | undefined {
  const values = {
    STORAGE_ENDPOINT: e.STORAGE_ENDPOINT,
    STORAGE_REGION: e.STORAGE_REGION,
    STORAGE_ACCESS_KEY_ID: e.STORAGE_ACCESS_KEY_ID,
    STORAGE_SECRET_ACCESS_KEY: e.STORAGE_SECRET_ACCESS_KEY,
    STORAGE_BUCKET: e.STORAGE_BUCKET,
  };
  const missing = Object.entries(values).filter(([, v]) => v === undefined);
  if (missing.length === Object.keys(values).length) return undefined;
  if (missing.length > 0) {
    throw new Error(`Invalid environment: also set ${missing.map(([k]) => k).join(', ')}`);
  }
  return {
    endpoint: values.STORAGE_ENDPOINT!,
    region: values.STORAGE_REGION!,
    accessKeyId: values.STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: values.STORAGE_SECRET_ACCESS_KEY!,
    bucket: values.STORAGE_BUCKET!,
  };
}
