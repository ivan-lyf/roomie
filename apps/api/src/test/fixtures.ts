import type { Product } from '@roomie/schema';

/** A valid catalog product, with any fields overridden. */
export const product = (articleNo: string, extra: Partial<Product> = {}): Product => ({
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
  modelUrl: `/api/models/${articleNo.replaceAll('.', '')}.glb`,
  modelSource: 'ikea',
  styleTags: [],
  scrapedAt: new Date('2026-10-21T00:00:00.000Z'),
  ...extra,
});
