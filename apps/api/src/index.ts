import { serve } from '@hono/node-server';
import { createApp } from './app';
import { type Auth, signingKeyCount, supabaseVerifier } from './auth';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { claudeIntentWriter } from './layouts/intent';
import { claudeNoteReader } from './ratings/notes';
import { claudeRoomReviser } from './ratings/revise';
import { claudeReader } from './plan-reader/claude';
import { geminiReader } from './plan-reader/gemini';
import { createStorage } from './storage';

const config = loadConfig();
const db = config.databaseUrl ? createDb(config.databaseUrl) : undefined;
if (!db) console.warn('DATABASE_URL is not set, so /api/products answers 503 (see .env.example).');
const storage = config.storage ? createStorage(config.storage) : undefined;
const plans = config.plansStorage ? createStorage(config.plansStorage) : undefined;
const reader =
  config.reader &&
  (config.reader.provider === 'claude' ? claudeReader(config.reader) : geminiReader(config.reader));
if (!reader) console.warn('No GEMINI_API_KEY or CLAUDE_API_KEY, so plans are traced by hand.');
const layoutWriter = config.layout && claudeIntentWriter(config.layout);
// Rating notes are read by the same model that furnishes homes (PLAN.md M7).
const noteReader = config.layout && claudeNoteReader(config.layout);
const roomReviser = config.layout && claudeRoomReviser(config.layout);
if (!layoutWriter) console.warn('No CLAUDE_API_KEY, so homes are furnished by hand.');
const auth: Auth | undefined =
  config.auth?.kind === 'supabase'
    ? { kind: 'verify', verify: supabaseVerifier(config.auth.url) }
    : config.auth;
if (!auth) {
  console.warn('No SUPABASE_URL, so the steps that call an LLM are refused (see .env.example).');
} else if (auth.kind === 'off') {
  console.warn(
    'AUTH=off: anyone can use the steps that call an LLM, as one local account. ' +
      'For local development only.',
  );
} else if (config.auth?.kind === 'supabase') {
  signingKeyCount(config.auth.url).then(
    (keys) => {
      if (keys > 0) return;
      console.warn(
        "The Supabase project publishes no JWT signing keys, so sessions can't be checked: " +
          'turn them on in the dashboard (Project Settings -> JWT Keys).',
      );
    },
    (e: unknown) => console.warn("Couldn't fetch the Supabase project's signing keys:", e),
  );
}
const app = createApp({
  dataDir: config.dataDir,
  db,
  storage,
  plans,
  reader,
  layoutWriter,
  ...(noteReader && { noteReader }),
  ...(roomReviser && { roomReviser }),
  ...(auth && { auth }),
  allowance: config.allowance,
  admins: config.admins,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
