import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { createStorage } from './storage';

const config = loadConfig();
const db = config.databaseUrl ? createDb(config.databaseUrl) : undefined;
if (!db) console.warn('DATABASE_URL is not set, so /api/products answers 503 (see .env.example).');
const storage = config.storage ? createStorage(config.storage) : undefined;
const app = createApp({ dataDir: config.dataDir, db, storage });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
