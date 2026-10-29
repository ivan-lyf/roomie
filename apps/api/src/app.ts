import { readFile } from 'node:fs/promises';
import { ArticleNo, Category, Product } from '@roomie/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { modelPath } from './catalog/store';
import type { Db } from './db/client';
import { floorplanRoutes } from './floorplans/routes';
import { products } from './db/schema';
import type { PlanReader } from './plan-reader/reader';
import type { Storage } from './storage';

export type AppOptions = {
  dataDir: string;
  /** The catalog's database; without one, /api/products answers 503. */
  db?: Db;
  /** Where the models are; without it, they're served from data/models. */
  storage?: Pick<Storage, 'signedUrl'>;
  /** Where uploaded plan images go; without it, under dataDir. */
  plans?: Pick<Storage, 'put' | 'get' | 'signedUrl'>;
  /** Reads uploaded plans; without one, they're traced by hand. */
  reader?: PlanReader;
};

const ProductList = z.array(Product);

export function createApp({ dataDir, db, storage, plans, reader }: AppOptions) {
  const app = new Hono().basePath('/api');

  app.get('/health', (c) => c.json({ ok: true }));

  app.route('/floorplans', floorplanRoutes({ db, plans, dataDir, reader }));

  /**
   * The catalog's active products, or one category's. With `articleNo` (comma-separated), those
   * products whatever their status, so a home still finds items IKEA has since dropped.
   */
  app.get('/products', async (c) => {
    const query = c.req.query('category');
    const category = query === undefined ? undefined : Category.safeParse(query);
    if (category && !category.success) return c.json({ error: `unknown category: ${query}` }, 400);
    const wanted = c.req.queries('articleNo')?.flatMap((q) => q.split(',')).filter(Boolean);
    const bad = wanted?.find((a) => !ArticleNo.safeParse(a).success);
    if (bad !== undefined) return c.json({ error: `not an article number: ${bad}` }, 400);
    if (!db) return c.json({ error: 'DATABASE_URL is not set' }, 503);
    if (wanted?.length === 0) return c.json([]);
    const rows = await db
      .select()
      .from(products)
      .where(
        and(
          wanted ? inArray(products.articleNo, wanted) : eq(products.status, 'active'),
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
    if (storage) {
      // The bucket is private, so send a signed link. It stays the same for the hour, which
      // lets the browser cache the model; this redirect is cached for less than the link lasts.
      c.header('cache-control', 'private, max-age=3000');
      return c.redirect(await storage.signedUrl(`${match[1]}.glb`), 302);
    }
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
