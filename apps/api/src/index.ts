import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';

const config = loadConfig();
const db = config.databaseUrl ? createDb(config.databaseUrl) : undefined;
if (!db) console.warn('DATABASE_URL is not set, so /api/products answers 503 (see .env.example).');

serve({ fetch: createApp({ dataDir: config.dataDir, db }).fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
