import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { StorageConfig } from './storage';

const defaultDataDir = fileURLToPath(new URL('../../../data', import.meta.url));

/**
 * The Gemini models that read plans, in order: Google's current Flash model (the free tier has no
 * Pro ones), then an older Flash model, as accurate on the test plans and faster, for when the
 * first is busy or out of its daily quota. `pnpm plans:eval --model` compares others.
 */
export const DEFAULT_GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash'];

/** The Claude model that reads plans when CLAUDE_MODEL doesn't name one. */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

/**
 * The Claude model that furnishes homes when LAYOUT_MODEL doesn't name one: Haiku, whose homes
 * were rated as good as Opus's (14 of 16 "I'd live with this"), at a thirtieth of the cost.
 */
export const DEFAULT_LAYOUT_MODEL = 'claude-haiku-5-5';

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
  // The vision model that reads uploaded plans: Gemini when there's a key, else Claude when
  // there's one, unless set to one of them or to none.
  PLAN_READER: unsetIfEmpty(z.enum(['gemini', 'claude', 'none']).optional()),
  GEMINI_API_KEY: optional(),
  /** One model, or several separated by commas, tried in order. */
  GEMINI_MODEL: optional(),
  CLAUDE_API_KEY: optional(),
  /** The name the Anthropic SDK looks for, taken when CLAUDE_API_KEY isn't set. */
  ANTHROPIC_API_KEY: optional(),
  CLAUDE_MODEL: unsetIfEmpty(z.string().default(DEFAULT_CLAUDE_MODEL)),
  CLAUDE_EFFORT: unsetIfEmpty(z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium')),
  /** The Claude model that furnishes homes (PLAN.md M4), on the same key. */
  LAYOUT_MODEL: unsetIfEmpty(z.string().default(DEFAULT_LAYOUT_MODEL)),
  LAYOUT_EFFORT: unsetIfEmpty(z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium')),
  // Sign-in (PLAN.md M6): the Supabase project whose sessions the routes that call an LLM accept.
  SUPABASE_URL: unsetIfEmpty(z.url().optional()),
  /** `off` opens those routes to anyone: local development only. */
  AUTH: unsetIfEmpty(z.enum(['supabase', 'off']).optional()),
  NODE_ENV: optional(),
  /** What each account may spend on LLM calls a day, in US dollars. */
  DAILY_ALLOWANCE_USD: unsetIfEmpty(z.coerce.number().nonnegative().default(1)),
  /** Where the allowance's day starts and ends. */
  ALLOWANCE_TIME_ZONE: unsetIfEmpty(z.string().default('America/Vancouver')),
});

export type GeminiReaderConfig = { provider: 'gemini'; apiKey: string; models: string[] };
export type ClaudeReaderConfig = {
  provider: 'claude';
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};
/** Which vision model reads plans, and how to reach it. */
export type ReaderConfig = GeminiReaderConfig | ClaudeReaderConfig;
/** The model that furnishes homes. */
export type LayoutConfig = Omit<ClaudeReaderConfig, 'provider'>;
/**
 * Who may use the routes that call an LLM: whoever is signed in to this Supabase project, or,
 * in local development, anyone.
 */
export type AuthConfig = { kind: 'supabase'; url: string } | { kind: 'off' };

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
  /** Every reader there's a key for, for `plans:eval --provider`. */
  readers: { gemini?: GeminiReaderConfig; claude?: ClaudeReaderConfig };
  /** Without a Claude key, homes are furnished by hand. */
  layout: LayoutConfig | undefined;
  /** Without it, the routes that call an LLM are refused. */
  auth: AuthConfig | undefined;
  allowance: { dailyUsd: number; timeZone: string };
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const storage = storageConfig(e);
  const [gemini, claude] = [geminiConfig(e), claudeConfig(e)];
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    dataDir: e.DATA_DIR,
    storage,
    plansStorage: storage && { ...storage, bucket: e.STORAGE_PLANS_BUCKET },
    reader: readerConfig(e),
    readers: {
      ...(gemini && { gemini }),
      ...(claude && { claude }),
    },
    layout: claude && { apiKey: claude.apiKey, model: e.LAYOUT_MODEL, effort: e.LAYOUT_EFFORT },
    auth: authConfig(e),
    allowance: { dailyUsd: e.DAILY_ALLOWANCE_USD, timeZone: timeZone(e.ALLOWANCE_TIME_ZONE) },
  };
}

function authConfig(e: z.infer<typeof Env>): AuthConfig | undefined {
  if (e.AUTH === 'off') {
    if (e.NODE_ENV === 'production') {
      throw new Error('Invalid environment: AUTH=off is for local development, not production');
    }
    return { kind: 'off' };
  }
  if (e.SUPABASE_URL) return { kind: 'supabase', url: e.SUPABASE_URL.replace(/\/+$/, '') };
  if (e.AUTH === 'supabase')
    throw new Error('Invalid environment: AUTH=supabase needs SUPABASE_URL');
  return undefined;
}

/** A time zone the platform knows, such as America/Vancouver. */
function timeZone(name: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return name;
  } catch {
    throw new Error(`Invalid environment: ALLOWANCE_TIME_ZONE ${name} isn't a time zone`);
  }
}

function readerConfig(e: z.infer<typeof Env>): ReaderConfig | undefined {
  if (e.PLAN_READER === 'none') return undefined;
  const [gemini, claude] = [geminiConfig(e), claudeConfig(e)];
  if (e.PLAN_READER === 'gemini' && !gemini) {
    throw new Error('Invalid environment: PLAN_READER=gemini needs GEMINI_API_KEY');
  }
  if (e.PLAN_READER === 'claude' && !claude) {
    throw new Error('Invalid environment: PLAN_READER=claude needs CLAUDE_API_KEY');
  }
  if (e.PLAN_READER === 'claude') return claude;
  return gemini ?? claude;
}

function geminiConfig(e: z.infer<typeof Env>): GeminiReaderConfig | undefined {
  if (!e.GEMINI_API_KEY) return undefined;
  const models = (e.GEMINI_MODEL ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m !== '');
  return {
    provider: 'gemini',
    apiKey: e.GEMINI_API_KEY,
    models: models.length > 0 ? models : DEFAULT_GEMINI_MODELS,
  };
}

function claudeConfig(e: z.infer<typeof Env>): ClaudeReaderConfig | undefined {
  const apiKey = e.CLAUDE_API_KEY ?? e.ANTHROPIC_API_KEY;
  if (!apiKey) return undefined;
  return { provider: 'claude', apiKey, model: e.CLAUDE_MODEL, effort: e.CLAUDE_EFFORT };
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
