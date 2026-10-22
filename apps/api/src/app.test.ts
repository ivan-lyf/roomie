import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';

const product = (articleNo: string) => ({
  articleNo,
  familyId: articleNo,
  options: [],
  name: `TESTA ${articleNo}`,
  category: 'sofa',
  status: 'active',
  priceCad: 499,
  url: `https://www.ikea.com/ca/en/p/testa-${articleNo.replaceAll('.', '')}/`,
  imageUrl: null,
  color: null,
  material: null,
  dims: { w: 2, d: 0.9, h: 0.8 },
  shape: 'rect',
  extendedW: null,
  modelUrl: null,
  modelSource: 'ikea',
  styleTags: [],
  scrapedAt: '2026-10-21T00:00:00.000Z',
});

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'roomie-api-'));
  await mkdir(path.join(dataDir, 'catalog'));
  await mkdir(path.join(dataDir, 'models'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const writeProducts = (products: unknown) =>
  writeFile(path.join(dataDir, 'catalog', 'products.json'), JSON.stringify(products));

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const res = await createApp({ dataDir }).request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('GET /api/products', () => {
  it('returns an empty list before the catalog is imported', async () => {
    await rm(path.join(dataDir, 'catalog'), { recursive: true });
    const res = await createApp({ dataDir }).request('/api/products');
    expect(await res.json()).toEqual([]);
  });

  it('links processed models', async () => {
    await writeProducts([product('111.111.11'), product('222.222.22')]);
    await writeFile(path.join(dataDir, 'models', '11111111.glb'), 'glTF');
    const res = await createApp({ dataDir }).request('http://localhost:5173/api/products');
    const body = (await res.json()) as { articleNo: string; modelUrl: string | null }[];
    expect(body.map((p) => [p.articleNo, p.modelUrl])).toEqual([
      ['111.111.11', 'http://localhost:5173/api/models/11111111.glb'],
      ['222.222.22', null],
    ]);
  });

  it('filters by category', async () => {
    await writeProducts([product('111.111.11'), { ...product('333.333.33'), category: 'bed' }]);
    const res = await createApp({ dataDir }).request('/api/products?category=bed');
    const body = (await res.json()) as { articleNo: string }[];
    expect(body.map((p) => p.articleNo)).toEqual(['333.333.33']);
  });

  it('rejects unknown categories', async () => {
    const res = await createApp({ dataDir }).request('/api/products?category=spaceship');
    expect(res.status).toBe(400);
  });

  it('fails on an invalid catalog instead of serving it', async () => {
    await writeProducts([{ ...product('111.111.11'), dims: { w: -1, d: 1, h: 1 } }]);
    const res = await createApp({ dataDir }).request('/api/products');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/models/:file', () => {
  it('serves a processed model', async () => {
    await writeFile(path.join(dataDir, 'models', '11111111.glb'), 'glTF');
    const res = await createApp({ dataDir }).request('/api/models/11111111.glb');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(await res.text()).toBe('glTF');
  });

  it('404s for missing models and other file names', async () => {
    const app = createApp({ dataDir });
    for (const file of ['22222222.glb', '..%2Fcatalog%2Fproducts.json', 'abc.glb']) {
      expect((await app.request(`/api/models/${file}`)).status).toBe(404);
    }
  });
});
