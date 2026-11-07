import { serve } from '@hono/node-server';
import app, { port } from './index';

// The API as a long-running server, for `pnpm dev`; on Vercel, `index.ts`'s app runs as a function.
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
