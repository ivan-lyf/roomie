import { readFile } from 'node:fs/promises';
import { ArticleNo, Category, Product } from '@roomie/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { Allowance, type AllowanceConfig } from './allowance';
import { type Auth, isAdmin, requireAccount } from './auth';
import { modelPath } from './catalog/store';
import type { Db } from './db/client';
import { floorplanRoutes } from './floorplans/routes';
import type { IntentWriter } from './layouts/intent';
import { layoutRoutes } from './layouts/routes';
import { products } from './db/schema';
import type { PlanReader } from './plan-reader/reader';
import type { NoteReader } from './ratings/notes';
import type { RoomReviser } from './ratings/revise';
import { ratingRoutes } from './ratings/routes';
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
  /** Furnishes homes; without one, they're furnished by hand. */
  layoutWriter?: IntentWriter;
  /** Solver seeds per room, fewer in tests. */
  layoutSeeds?: number;
  /** Who may use the routes that call an LLM (PLAN.md M6); without it, they're refused. */
  auth?: Auth;
  /** What each account may spend on them a day: by default $1, by Vancouver's calendar. */
  allowance?: AllowanceConfig;
  /** The emails of the accounts that may use the internal pages (M7). */
  admins?: readonly string[];
  /** Reads rating notes into labels (M7); without one, they're kept unread. */
  noteReader?: NoteReader;
  /** Revises a room from what a rater said ("Tell it", M7). */
  roomReviser?: RoomReviser;
  /** The time now, for tests of the allowance's day. */
  now?: () => Date;
};

export const DEFAULT_ALLOWANCE: AllowanceConfig = { dailyUsd: 1, timeZone: 'America/Vancouver' };

const ProductList = z.array(Product);

export function createApp(options: AppOptions) {
  const { dataDir, db, storage, plans, reader } = options;
  const app = new Hono().basePath('/api');

  app.get('/health', (c) => c.json({ ok: true }));

  const { auth } = options;
  const allowance = db && new Allowance(db, options.allowance ?? DEFAULT_ALLOWANCE, options.now);

  /**
   * The signed-in account, what it has spent on LLM calls today (PLAN.md M6), and whether it may
   * use the internal pages (M7).
   */
  app.get('/me', requireAccount(auth), async (c) => {
    if (!allowance) return c.json({ error: 'DATABASE_URL is not set' }, 503);
    const admin = isAdmin(c.var.account, auth, options.admins ?? []);
    return c.json({ ...(await allowance.today(c.var.account)), admin });
  });

  app.route('/floorplans', floorplanRoutes({ db, plans, dataDir, reader, auth, allowance }));
  app.route(
    '/admin',
    ratingRoutes({
      db,
      auth,
      admins: options.admins ?? [],
      noteReader: options.noteReader,
      reviser: options.roomReviser,
      allowance,
    }),
  );
  app.route(
    '/',
    layoutRoutes({
      db,
      writer: options.layoutWriter,
      seeds: options.layoutSeeds,
      auth,
      allowance,
    }),
  );

  /**
   * The catalog's active products, or one category's. With `articleNo` (comma-separated), those
   * products whatever their status, so a home still finds items IKEA has since dropped.
   */
  app.get('/products', async (c) => {
    const query = c.req.query('category');
    const category = query === undefined ? undefined : Category.safeParse(query);
    if (category && !category.success) return c.json({ error: `unknown category: ${query}` }, 400);
    const wanted = c.req
      .queries('articleNo')
      ?.flatMap((q) => q.split(','))
      .filter(Boolean);
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
