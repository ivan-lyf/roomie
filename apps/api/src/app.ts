import { readFile } from 'node:fs/promises';
import { Category, Product } from '@roomie/schema';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { modelPath } from './catalog/store';
import type { Db } from './db/client';
import { products } from './db/schema';

export type AppOptions = {
  dataDir: string;
  /** The catalog's database; without one, /api/products answers 503. */
  db?: Db;
};

const ProductList = z.array(Product);

export function createApp({ dataDir, db }: AppOptions) {
  const app = new Hono().basePath('/api');

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/products', async (c) => {
    const query = c.req.query('category');
    const category = query === undefined ? undefined : Category.safeParse(query);
    if (category && !category.success) return c.json({ error: `unknown category: ${query}` }, 400);
    if (!db) return c.json({ error: 'DATABASE_URL is not set' }, 503);
    const rows = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.status, 'active'),
          category ? eq(products.category, category.data) : undefined,
        ),
      )
      .orderBy(products.articleNo);
    // JSONB columns (dims, options) are only typed, so validate them on the way out too.
    return c.json(ProductList.parse(rows));
  });

  app.get('/models/:file', async (c) => {
    const match = /^(\d{8})\.glb$/.exec(c.req.param('file'));
    if (!match?.[1]) return c.notFound();
    let body: Buffer;
    try {
      body = await readFile(modelPath(dataDir, match[1]));
    } catch {
      return c.notFound();
    }
    return c.body(new Uint8Array(body), 200, { 'content-type': 'model/gltf-binary' });
  });

  return app;
}
