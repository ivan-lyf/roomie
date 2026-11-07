import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Floorplan, FloorplanSummary, Product } from '@roomie/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { createApp, type AppOptions } from '../app';
import { products } from '../db/schema';
import { testHomePlan } from '../ratings/pool';
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

/** Two accounts, signed in by token. */
const accounts = {
  kind: 'verify' as const,
  verify: async (token: string) =>
    ({
      ann: { id: '00000000-0000-4000-8000-0000000000a1', email: 'ann@example.com' },
      bob: { id: '00000000-0000-4000-8000-0000000000b2', email: 'bob@example.com' },
    })[token],
};
const as = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

async function list(query = '', init: RequestInit = {}, options: Partial<AppOptions> = {}) {
  const res = await app(options).request(`/api/floorplans${query}`, init);
  expect(res.status).toBe(200);
  return FloorplanSummary.array().parse(await res.json());
}

describe('floorplans', () => {
  it("lists this browser's plans, most recently changed first", async () => {
    const first = await uploaded();
    const second = await uploaded();
    await uploaded();
    await app().request(`/api/floorplans/${first.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...first, name: 'Renamed' }),
    });
    expect((await list(`?ids=${second.id},${first.id},nonsense`)).map((p) => [p.id, p.name])).toEqual([
      [first.id, 'Renamed'],
      [second.id, 'Unit 4B'],
    ]);
  });

  it("lists nobody's plans to someone with none", async () => {
    await uploaded();
    expect(await list()).toEqual([]);
  });

  it("gives a plan made signed in to its account, and lists the account's plans anywhere", async () => {
    const options = { auth: accounts };
    const anns = await uploaded(options);
    const res = await app(options).request('/api/floorplans', {
      method: 'POST',
      body: (() => {
        const form = new FormData();
        form.set('image', new File([new Uint8Array(pngHeader(10, 10))], 'a.png'));
        return form;
      })(),
      ...as('ann'),
    });
    const owned = Floorplan.parse(await res.json());
    expect((await list('', as('ann'), options)).map((p) => p.id)).toEqual([owned.id]);
    expect(await list('', as('bob'), options)).toEqual([]);
    // Bob's browser holds the id of the one Ann made signed out, and sees it with his own.
    expect((await list(`?ids=${anns.id}`, as('bob'), options)).map((p) => p.id)).toEqual([
      anns.id,
    ]);
  });

  it("claims this browser's unowned plans on signing in, and nobody else's", async () => {
    const options = { auth: accounts };
    const loose = await uploaded();
    const post = (token: string, ids: string[]) =>
      app(options).request('/api/floorplans/claim', {
        method: 'POST',
        body: JSON.stringify({ ids }),
        headers: { authorization: `Bearer ${token}` },
      });
    expect(await (await post('ann', [loose.id])).json()).toEqual({ claimed: 1 });
    expect(await (await post('bob', [loose.id])).json()).toEqual({ claimed: 0 });
    expect((await list('', as('ann'), options)).map((p) => p.id)).toEqual([loose.id]);
    const signedOut = await app(options).request('/api/floorplans/claim', {
      method: 'POST',
      body: JSON.stringify({ ids: [loose.id] }),
    });
    expect(signedOut.status).toBe(401);
  });

  it('sums up what is in each home for its card', async () => {
    await db.insert(products).values(Product.array().parse(catalog));
    const [a, b] = Product.array().parse(catalog);
    const plan = await uploaded();
    const at = { roomId: 'r1', x: 1, y: 1, rotation: 0 };
    await app().request(`/api/floorplans/${plan.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...plan,
        furniture: [
          { id: 'f1', articleNo: a!.articleNo, ...at },
          { id: 'f2', articleNo: a!.articleNo, ...at },
          { id: 'f3', articleNo: b!.articleNo, ...at },
        ],
      }),
    });
    const [card] = await list(`?ids=${plan.id}`);
    expect(card).toMatchObject({ hasImage: true, itemCount: 3 });
    expect(card!.totalCad).toBeCloseTo(2 * a!.priceCad + b!.priceCad, 2);
  });

  it('copies the sample apartment as a home of its own, with its image', async () => {
    const res = await app().request('/api/floorplans/sample', { method: 'POST' });
    expect(res.status).toBe(201);
    const sample = Floorplan.parse(await res.json());
    const original = Floorplan.parse(demo);
    expect(sample).toMatchObject({ name: 'Sample apartment', source: 'upload', status: 'ready' });
    expect(sample.id).not.toBe(original.id);
    expect(sample.rooms).toEqual(original.rooms);
    expect(sample.furniture).toEqual([]);
    const image = await app().request(`/api/floorplans/${sample.id}/image`);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect((await list(`?ids=${sample.id}`)).map((p) => p.name)).toEqual(['Sample apartment']);
  });

  it('leaves the test homes added to rate out of the list, but opens them', async () => {
    const mine = await uploaded();
    const added = await testHomePlan(db, { name: '00-demo-1br', plan: Floorplan.parse(demo) });
    expect((await list(`?ids=${mine.id},${added!.plan.id}`)).map((p) => p.id)).toEqual([mine.id]);
    const res = await app().request(`/api/floorplans/${added!.plan.id}`);
    expect(Floorplan.parse(await res.json()).source).toBe('test_set');
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
