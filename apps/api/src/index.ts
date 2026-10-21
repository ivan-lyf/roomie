import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();

serve({ fetch: createApp().fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
