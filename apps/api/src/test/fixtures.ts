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

/** A minimal PNG header: signature, then the IHDR chunk with the size. */
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
