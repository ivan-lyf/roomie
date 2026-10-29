import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { claudeIntentWriter } from './layouts/intent';
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
if (!layoutWriter) console.warn('No CLAUDE_API_KEY, so homes are furnished by hand.');
const app = createApp({ dataDir: config.dataDir, db, storage, plans, reader, layoutWriter });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
