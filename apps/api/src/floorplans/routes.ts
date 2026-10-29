import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CEILING_HEIGHT, isTraced, planStatus } from '@roomie/geometry';
import { Floorplan, FloorplanEdit, FloorplanSummary, type Materials } from '@roomie/schema';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Db } from '../db/client';
import { floorplans } from '../db/schema';
import { ReadingCache } from '../plan-reader/cache';
import { type PlanReader, ReaderError } from '../plan-reader/reader';
import type { Storage } from '../storage';
import { readImageInfo } from './image';
import { applyReading } from './reading';

/** The browser scales plans down to 3,000 px before uploading, so this is plenty. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** A new home's look until the user changes it. */
export const DEFAULT_MATERIALS: Materials = {
  wallColor: '#f3efe7',
  floor: 'light_oak',
  light: { warmthK: 3000, intensity: 0.7 },
};

const CONTENT_TYPES = { png: 'image/png', jpeg: 'image/jpeg' } as const;
const EXTENSIONS = { png: 'png', jpeg: 'jpg' } as const;

export type FloorplanOptions = {
  db: Db | undefined;
  /** The private bucket for plan images; without it they're kept under `dataDir`. */
  plans: Pick<Storage, 'put' | 'get' | 'signedUrl'> | undefined;
  dataDir: string;
  /** Reads uploaded plans; without one, plans are traced by hand. */
  reader?: PlanReader | undefined;
};

/**
 * Upload a plan image, list the plans, load and save one, and have one read. Mounted at
 * /api/floorplans.
 */
export function floorplanRoutes({ db, plans, dataDir, reader }: FloorplanOptions) {
  const app = new Hono<{ Variables: { db: Db } }>();
  const localPath = (key: string) => path.join(dataDir, 'uploads', 'plans', key);
  // The readings `plans:eval` keeps too, by image, model and prompt version.
  const readings = new ReadingCache(path.join(dataDir, 'cache', 'plan-reader'));

  app.use(async (c, next) => {
    if (!db) return c.json({ error: 'DATABASE_URL is not set' }, 503);
    c.set('db', db);
    await next();
  });

  /** The plan with this id, read back through zod (its JSONB columns are only typed). */
  const load = async (db: Db, id: string): Promise<Floorplan | undefined> => {
    if (!z.uuid().safeParse(id).success) return undefined;
    const [row] = await db.select().from(floorplans).where(eq(floorplans.id, id));
    return row && Floorplan.parse(row);
  };

  app.post(
    '/',
    bodyLimit({
      maxSize: MAX_IMAGE_BYTES + 64 * 1024,
      onError: (c) => c.json({ error: 'The image is over 15 MB.' }, 413),
    }),
    async (c) => {
      const body = await c.req.parseBody();
      const file = body['image'];
      if (!(file instanceof File)) return c.json({ error: 'Send the plan as `image`.' }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = readImageInfo(bytes);
      if (!info) return c.json({ error: 'The plan has to be a PNG or JPEG image.' }, 415);

      const id = randomUUID();
      const key = `${id}.${EXTENSIONS[info.type]}`;
      if (plans) {
        await plans.put(key, bytes, CONTENT_TYPES[info.type]);
      } else {
        await mkdir(path.dirname(localPath(key)), { recursive: true });
        await writeFile(localPath(key), bytes);
      }
      const given = typeof body['name'] === 'string' ? body['name'].trim() : '';
      const name = (given || file.name.replace(/\.[^.]+$/, '') || 'My home').slice(0, 120);
      const [row] = await c.var.db
        .insert(floorplans)
        .values({
          id,
          name,
          status: 'uploaded',
          image: { key, width: info.width, height: info.height },
          walls: [],
          openings: [],
          rooms: [],
          obstacles: [],
          labels: [],
          scale: null,
          ceilingHeight: DEFAULT_CEILING_HEIGHT,
          ceilingHeightSource: 'default',
          materials: DEFAULT_MATERIALS,
          reading: null,
        })
        .returning();
      return c.json(Floorplan.parse(row), 201);
    },
  );

  app.get('/', async (c) => {
    const rows = await c.var.db
      .select({
        id: floorplans.id,
        name: floorplans.name,
        status: floorplans.status,
        createdAt: floorplans.createdAt,
        updatedAt: floorplans.updatedAt,
      })
      .from(floorplans)
      .orderBy(desc(floorplans.updatedAt));
    return c.json(z.array(FloorplanSummary).parse(rows));
  });

  app.get('/:id', async (c) => {
    const plan = await load(c.var.db, c.req.param('id'));
    return plan ? c.json(plan) : c.json({ error: 'No such floor plan.' }, 404);
  });

  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    const saved = await load(c.var.db, id);
    if (!saved) return c.json({ error: 'No such floor plan.' }, 404);
    const edit = FloorplanEdit.safeParse(await c.req.json().catch(() => undefined));
    if (!edit.success) return c.json({ error: z.prettifyError(edit.error) }, 400);
    // The status follows from the plan, whatever the client says.
    const status = planStatus({ ...saved, ...edit.data });
    const [row] = await c.var.db
      .update(floorplans)
      .set({ ...edit.data, status, updatedAt: new Date() })
      .where(eq(floorplans.id, id))
      .returning();
    return c.json(Floorplan.parse(row));
  });

  /**
   * Reads the plan's image with the plan reader. A plan that's already traced is only read again
   * with `?replace=1`, since the reading replaces what was traced. A first reading of an image
   * read before, by the same model and prompt, comes from the cache and costs nothing; reading
   * again always asks afresh, since another reading is the point of it.
   */
  app.post('/:id/read', async (c) => {
    if (!reader) {
      return c.json({ error: 'No plan reader is set up: add GEMINI_API_KEY to .env.' }, 503);
    }
    const plan = await load(c.var.db, c.req.param('id'));
    if (!plan) return c.json({ error: 'No such floor plan.' }, 404);
    if (!plan.image) return c.json({ error: 'The plan has no image to read.' }, 400);
    const replace = c.req.query('replace') === '1';
    if (isTraced(plan) && !replace) {
      return c.json({ error: 'The plan is already traced: read it again with replace=1.' }, 409);
    }
    const { key, width, height } = plan.image;
    const bytes = plans
      ? await plans.get(key)
      : await readFile(localPath(key)).then(
          (b) => new Uint8Array(b),
          () => undefined,
        );
    if (!bytes) return c.json({ error: 'The image file is missing.' }, 404);

    const mimeType = key.endsWith('.png') ? CONTENT_TYPES.png : CONTENT_TYPES.jpeg;
    const image = { bytes, mimeType, width, height };
    let result = replace ? undefined : await readings.get(image, reader);
    if (!result) {
      try {
        result = await reader.read(image, c.req.raw.signal);
      } catch (e) {
        if (e instanceof ReaderError) return c.json({ error: e.message }, e.status);
        throw e;
      }
      await readings.put(image, reader, result);
    }
    // Reading takes minutes: the plan as saved now keeps anything saved meanwhile (its name, a
    // scale the user measured), and the reading replaces only what was traced.
    const latest = await load(c.var.db, plan.id);
    if (!latest) return c.json({ error: 'No such floor plan.' }, 404);
    const read = applyReading({ ...latest, image: plan.image }, reader, result);
    const [row] = await c.var.db
      .update(floorplans)
      .set({ ...read, updatedAt: new Date() })
      .where(eq(floorplans.id, plan.id))
      .returning();
    return c.json(Floorplan.parse(row));
  });

  app.get('/:id/image', async (c) => {
    const plan = await load(c.var.db, c.req.param('id'));
    if (!plan?.image) return c.json({ error: 'No such floor plan image.' }, 404);
    const { key } = plan.image;
    if (plans) {
      // Like the models: a link signed for the hour, so the browser can cache the image.
      c.header('cache-control', 'private, max-age=3000');
      return c.redirect(await plans.signedUrl(key), 302);
    }
    const type = key.endsWith('.png') ? CONTENT_TYPES.png : CONTENT_TYPES.jpeg;
    try {
      return c.body(new Uint8Array(await readFile(localPath(key))), 200, { 'content-type': type });
    } catch {
      return c.json({ error: 'The image file is missing.' }, 404);
    }
  });

  return app;
}
