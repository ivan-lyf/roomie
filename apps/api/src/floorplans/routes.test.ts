import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Floorplan, FloorplanSummary } from '@roomie/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { createApp, type AppOptions } from '../app';
import { testDb } from '../test/db';
import { pngHeader } from '../test/fixtures';

let dataDir: string;
let db: Awaited<ReturnType<typeof testDb>>;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'roomie-plans-'));
  db = await testDb();
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const app = (options: Partial<AppOptions> = {}) => createApp({ dataDir, db, ...options });

function upload(bytes: Uint8Array, fields: Record<string, string> = {}, options = {}) {
  const form = new FormData();
  form.set('image', new File([new Uint8Array(bytes)], 'Unit 4B.png', { type: 'image/png' }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return app(options).request('/api/floorplans', { method: 'POST', body: form });
}

async function uploaded(options = {}): Promise<Floorplan> {
  const res = await upload(pngHeader(1200, 900), {}, options);
  expect(res.status).toBe(201);
  return Floorplan.parse(await res.json());
}

describe('POST /api/floorplans', () => {
  it('stores the image and starts an empty plan named after the file', async () => {
    const plan = await uploaded();
    expect(plan).toMatchObject({
      name: 'Unit 4B',
      status: 'uploaded',
      image: { key: `${plan.id}.png`, width: 1200, height: 900 },
      walls: [],
      rooms: [],
      scale: null,
      ceilingHeight: 2.44,
      ceilingHeightSource: 'default',
    });
    const saved = await readFile(path.join(dataDir, 'uploads', 'plans', `${plan.id}.png`));
    expect(new Uint8Array(saved)).toEqual(pngHeader(1200, 900));
  });

  it('takes a name, and puts the image in the bucket when there is one', async () => {
    const puts: [string, string][] = [];
    const plans = {
      put: async (key: string, _body: Uint8Array, type: string) => void puts.push([key, type]),
      get: async () => undefined,
      signedUrl: async (key: string) => `https://storage.test/plans/${key}?signed`,
    };
    const res = await upload(pngHeader(10, 10), { name: '  My condo ' }, { plans });
    const plan = Floorplan.parse(await res.json());
    expect(plan.name).toBe('My condo');
    expect(puts).toEqual([[`${plan.id}.png`, 'image/png']]);
    const image = await app({ plans }).request(`/api/floorplans/${plan.id}/image`);
    expect(image.status).toBe(302);
    expect(image.headers.get('location')).toBe(`https://storage.test/plans/${plan.id}.png?signed`);
  });

  it('refuses files that are not PNG or JPEG images', async () => {
    const res = await upload(new TextEncoder().encode('%PDF-1.7'));
    expect(res.status).toBe(415);
    const empty = await app().request('/api/floorplans', { method: 'POST', body: new FormData() });
    expect(empty.status).toBe(400);
  });

  it('answers 503 without a database', async () => {
    const res = await upload(pngHeader(10, 10), {}, { db: undefined });
    expect(res.status).toBe(503);
  });
});

describe('floorplans', () => {
  it('lists plans, most recently changed first', async () => {
    const first = await uploaded();
    const second = await uploaded();
    await app().request(`/api/floorplans/${first.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...first, name: 'Renamed' }),
    });
    const list = FloorplanSummary.array().parse(
      await (await app().request('/api/floorplans')).json(),
    );
    expect(list.map((p) => [p.id, p.name])).toEqual([
      [first.id, 'Renamed'],
      [second.id, 'Unit 4B'],
    ]);
  });

  it('saves edits but keeps the id, image and timestamps its own', async () => {
    const plan = await uploaded();
    const sofa = { id: 'f1', articleNo: '123.456.78', roomId: 'r1', x: 2, y: 3, rotation: 0 };
    const edit = {
      ...Floorplan.parse(demo),
      id: 'ignored',
      image: null,
      furniture: [sofa],
      furnishedFrom: '00000000-0000-4000-8000-000000000001',
    };
    const res = await app().request(`/api/floorplans/${plan.id}`, {
      method: 'PUT',
      body: JSON.stringify(edit),
    });
    expect(res.status).toBe(200);
    const saved = Floorplan.parse(await (await app().request(`/api/floorplans/${plan.id}`)).json());
    expect(saved).toMatchObject({
      id: plan.id,
      image: plan.image,
      name: 'Demo one-bedroom',
      status: 'ready',
    });
    expect(saved.rooms).toEqual(edit.rooms);
    expect(saved.furniture).toEqual([sofa]);
    expect(saved.furnishedFrom).toBeNull();
    expect(saved.createdAt).toEqual(plan.createdAt);
    expect(saved.updatedAt.getTime()).toBeGreaterThan(plan.updatedAt.getTime());
  });

  it('works out the status from the plan', async () => {
    const plan = await uploaded();
    const save = async (edit: object) => {
      const res = await app().request(`/api/floorplans/${plan.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...plan, ...edit, status: 'ready' }),
      });
      return Floorplan.parse(await res.json()).status;
    };
    expect(await save({})).toBe('needs_calibration');
    const scale = Floorplan.parse(demo).scale;
    expect(await save({ scale })).toBe('uploaded');
  });

  it('rejects an invalid edit with the reason', async () => {
    const plan = await uploaded();
    const res = await app().request(`/api/floorplans/${plan.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...plan, ceilingHeight: -1 }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/ceilingHeight/);
  });

  it('answers 404 for plans that do not exist', async () => {
    for (const id of ['00000000-0000-4000-8000-00000000abcd', 'not-a-uuid']) {
      expect((await app().request(`/api/floorplans/${id}`)).status).toBe(404);
      expect((await app().request(`/api/floorplans/${id}/image`)).status).toBe(404);
    }
  });

  it('serves the image from disk without a bucket', async () => {
    const plan = await uploaded();
    const res = await app().request(`/api/floorplans/${plan.id}/image`);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pngHeader(1200, 900));
  });
});
