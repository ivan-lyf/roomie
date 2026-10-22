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

/** A model manifest, as `pnpm models:process` writes it: item number -> model source. */
const writeModels = (sources: Record<string, 'ikea' | 'procedural' | null>) =>
  writeFile(
    path.join(dataDir, 'models', 'manifest.json'),
    JSON.stringify({
      pipelineVersion: 1,
      generatedAt: '2026-10-21T00:00:00.000Z',
      entries: Object.entries(sources).map(([itemNo, source]) => ({
        itemNo,
        category: 'sofa',
        outcome: source === 'ikea' ? 'fitted' : 'no_model',
        source,
        bytes: source ? 100 : null,
        scale: null,
        notes: [],
        inputs: '',
      })),
    }),
  );

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

  it('links each product to the model the pipeline made for it', async () => {
    await writeProducts([product('111.111.11'), product('222.222.22'), product('333.333.33')]);
    await writeModels({ '11111111': 'ikea', '22222222': 'procedural', '33333333': null });
    const res = await createApp({ dataDir }).request('http://localhost:5173/api/products');
    const body = (await res.json()) as {
      articleNo: string;
      modelSource: string;
      modelUrl: string | null;
    }[];
    expect(body.map((p) => [p.articleNo, p.modelSource, p.modelUrl])).toEqual([
      ['111.111.11', 'ikea', 'http://localhost:5173/api/models/11111111.glb'],
      ['222.222.22', 'procedural', 'http://localhost:5173/api/models/22222222.glb'],
      ['333.333.33', 'ikea', null],
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
