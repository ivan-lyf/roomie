import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CEILING_HEIGHT, planStatus } from '@roomie/geometry';
import { Floorplan, FloorplanEdit, FloorplanSummary, type Materials } from '@roomie/schema';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Db } from '../db/client';
import { floorplans } from '../db/schema';
import type { Storage } from '../storage';
import { readImageInfo } from './image';

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
  plans: Pick<Storage, 'put' | 'signedUrl'> | undefined;
  dataDir: string;
};

/** Upload a plan image, list the plans, and load and save one. Mounted at /api/floorplans. */
export function floorplanRoutes({ db, plans, dataDir }: FloorplanOptions) {
  const app = new Hono<{ Variables: { db: Db } }>();
  const localPath = (key: string) => path.join(dataDir, 'uploads', 'plans', key);

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
