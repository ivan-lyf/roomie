import type { ModelManifestEntry, ModelSource } from '@roomie/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { products } from '../db/schema';
import { testDb } from '../test/db';
import { product } from '../test/fixtures';
import { publishCatalog } from './publish';

let db: Awaited<ReturnType<typeof testDb>>;

beforeEach(async () => {
  db = await testDb();
});

/** A manifest of item number -> the model the pipeline made. */
const models = (sources: Record<string, ModelSource | null>) =>
  new Map(
    Object.entries(sources).map(([itemNo, source]): [string, ModelManifestEntry] => [
      itemNo,
      {
        itemNo,
        category: 'sofa',
        outcome: source === 'ikea' ? 'fitted' : 'no_model',
        source,
        bytes: source ? 100 : null,
        scale: null,
        bounds: null,
        rawSize: null,
        fromItemNo: null,
        notes: [],
        inputs: '',
      },
    ]),
  );

const rows = () => db.select().from(products).orderBy(products.articleNo);

describe('publishCatalog', () => {
  it('writes each product with the model the pipeline made for it', async () => {
    const catalog = [
      product('111.111.11', { modelUrl: null, modelSource: 'procedural' }),
      product('222.222.22', { modelUrl: null }),
      product('333.333.33', { modelUrl: null }),
    ];
    await publishCatalog(
      db,
      catalog,
      models({ '11111111': 'ikea', '22222222': 'procedural', '33333333': null }),
    );
    expect((await rows()).map((r) => [r.articleNo, r.modelSource, r.modelUrl])).toEqual([
      ['111.111.11', 'ikea', '/api/models/11111111.glb'],
      ['222.222.22', 'procedural', '/api/models/22222222.glb'],
      ['333.333.33', 'procedural', null],
    ]);
  });

  it('updates products already published', async () => {
    await publishCatalog(db, [product('111.111.11', { priceCad: 499 })], models({}));
    await publishCatalog(db, [product('111.111.11', { priceCad: 549 })], models({}));
    expect((await rows()).map((r) => r.priceCad)).toEqual([549]);
  });

  it('marks products gone from the catalog as discontinued instead of deleting them', async () => {
    await publishCatalog(db, [product('111.111.11'), product('222.222.22')], models({}));
    const result = await publishCatalog(db, [product('111.111.11')], models({}));
    expect(result).toEqual({ active: 1, discontinued: 1 });
    expect((await rows()).map((r) => [r.articleNo, r.status])).toEqual([
      ['111.111.11', 'active'],
      ['222.222.22', 'discontinued'],
    ]);
  });

  it('brings a product back when it returns', async () => {
    await publishCatalog(db, [product('111.111.11'), product('222.222.22')], models({}));
    await publishCatalog(db, [product('111.111.11')], models({}));
    await publishCatalog(db, [product('111.111.11'), product('222.222.22')], models({}));
    expect((await rows()).map((r) => r.status)).toEqual(['active', 'active']);
  });

  it('refuses an empty catalog, which would discontinue everything', async () => {
    await expect(publishCatalog(db, [], models({}))).rejects.toThrow(/empty catalog/);
  });
});
