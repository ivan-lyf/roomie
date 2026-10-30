import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Me, type Product } from '@roomie/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { products } from './db/schema';
import { testDb } from './test/db';
import { product } from './test/fixtures';

let dataDir: string;
let db: Awaited<ReturnType<typeof testDb>>;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'roomie-api-'));
  await mkdir(path.join(dataDir, 'models'));
  db = await testDb();
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const get = (url: string) => createApp({ dataDir, db }).request(url);
const articleNos = async (res: Response) =>
  ((await res.json()) as Product[]).map((p) => p.articleNo);

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('GET /api/products', () => {
  it('returns an empty list before the catalog is published', async () => {
    expect(await (await get('/api/products')).json()).toEqual([]);
  });

  it('serves active products, with their model links', async () => {
    await db
      .insert(products)
      .values([
        product('111.111.11'),
        product('222.222.22', { modelSource: 'procedural' }),
        product('333.333.33', { status: 'discontinued' }),
      ]);
    const body = (await (await get('/api/products')).json()) as Product[];
    expect(body.map((p) => [p.articleNo, p.modelSource, p.modelUrl])).toEqual([
      ['111.111.11', 'ikea', '/api/models/11111111.glb'],
      ['222.222.22', 'procedural', '/api/models/22222222.glb'],
    ]);
  });

  it('filters by category', async () => {
    await db
      .insert(products)
      .values([product('111.111.11'), product('333.333.33', { category: 'bed' })]);
    expect(await articleNos(await get('/api/products?category=bed'))).toEqual(['333.333.33']);
  });

  it('finds products by article number, discontinued ones too', async () => {
    await db
      .insert(products)
      .values([
        product('111.111.11'),
        product('222.222.22'),
        product('333.333.33', { status: 'discontinued' }),
      ]);
    const url = '/api/products?articleNo=333.333.33,111.111.11&articleNo=999.999.99';
    expect(await articleNos(await get(url))).toEqual(['111.111.11', '333.333.33']);
    expect(await (await get('/api/products?articleNo=')).json()).toEqual([]);
    expect((await get('/api/products?articleNo=11111111')).status).toBe(400);
  });

  it('rejects unknown categories', async () => {
    expect((await get('/api/products?category=spaceship')).status).toBe(400);
  });

  it('answers 503 without a database', async () => {
    const res = await createApp({ dataDir }).request('/api/products');
    expect(res.status).toBe(503);
  });

  it('fails on an invalid row instead of serving it', async () => {
    await db.insert(products).values([product('111.111.11', { dims: { w: -1, d: 1, h: 1 } })]);
    expect((await get('/api/products')).status).toBe(500);
  });
});

describe('GET /api/models/:file', () => {
  it('serves a processed model', async () => {
    await writeFile(path.join(dataDir, 'models', '11111111.glb'), 'glTF');
    const res = await get('/api/models/11111111.glb');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(await res.text()).toBe('glTF');
  });

  it('redirects to a signed link when the models are in storage', async () => {
    const storage = {
      signedUrl: async (key: string) => `https://files.example/models/${key}?sig=1`,
    };
    const res = await createApp({ dataDir, db, storage }).request('/api/models/11111111.glb');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://files.example/models/11111111.glb?sig=1');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3000');
  });

  it('404s for missing models and other file names', async () => {
    for (const file of ['22222222.glb', '..%2Fcatalog%2Fproducts.json', 'abc.glb']) {
      expect((await get(`/api/models/${file}`)).status).toBe(404);
    }
  });
});

describe('GET /api/me', () => {
  const me = { id: '11111111-2222-4333-8444-555555555555', email: 'ivan@example.com' };
  const auth = {
    kind: 'verify' as const,
    verify: async (token: string) => (token === 'good' ? me : undefined),
  };

  it("answers the signed-in account and today's spending", async () => {
    const app = createApp({
      dataDir,
      db,
      auth,
      allowance: { dailyUsd: 2, timeZone: 'UTC' },
      now: () => new Date('2026-10-29T12:00:00Z'),
    });
    const res = await app.request('/api/me', { headers: { authorization: 'Bearer good' } });
    expect(Me.parse(await res.json())).toEqual({
      ...me,
      spentUsd: 0,
      allowanceUsd: 2,
      resetsAt: new Date('2026-10-30T00:00:00Z'),
      admin: false,
    });
  });

  it('says whether the account may use the internal pages', async () => {
    const admin = async (admins: string[]) => {
      const app = createApp({ dataDir, db, auth, admins });
      const res = await app.request('/api/me', { headers: { authorization: 'Bearer good' } });
      return Me.parse(await res.json()).admin;
    };
    expect(await admin(['ivan@example.com'])).toBe(true);
    expect(await admin(['someone@example.com'])).toBe(false);
    // Sign-in off for local development: the local account is an admin.
    const app = createApp({ dataDir, db, auth: { kind: 'off' } });
    expect(Me.parse(await (await app.request('/api/me')).json()).admin).toBe(true);
  });

  it('needs sign-in', async () => {
    const app = createApp({ dataDir, db, auth });
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'sign_in_required' });
  });
});
