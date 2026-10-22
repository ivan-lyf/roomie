import { describe, expect, it } from 'vitest';
import { type IkeaItem, itemNoOf, toProduct } from './ikea';

const measure = (name: string, meters: number) => ({
  name,
  text: `${Math.round(meters * 100)} cm`,
  minM: meters,
  maxM: meters,
});

const sofa: IkeaItem = {
  itemNo: '59442483',
  articleNo: '594.424.83',
  url: 'https://www.ikea.com/ca/en/p/uppland-sofa-kilanda-light-beige-s59442483/',
  name: 'UPPLAND Sofa - Kilanda light beige',
  priceCad: 749,
  currency: 'CAD',
  categoryPath: [
    { id: '700640', name: 'Sofas & armchairs' },
    { id: 'fu003', name: 'Sofas' },
  ],
  measurements: [
    measure('Width', 2.24),
    measure('Depth', 0.92),
    measure('Backrest height', 0.76),
    measure('Height including back cushions', 0.92),
  ],
  imageUrl: null,
  modelUrl: null,
  scrapedAt: '2026-10-21T15:55:24+00:00',
};

describe('toProduct', () => {
  it('maps a sofa to a product in meters', () => {
    const result = toProduct(sofa, false);
    expect(result).toMatchObject({
      ok: true,
      product: {
        articleNo: '594.424.83',
        category: 'sofa',
        priceCad: 749,
        dims: { w: 2.24, d: 0.92, h: 0.92 },
        modelSource: 'procedural',
        modelUrl: null,
      },
    });
  });

  it('prefers Height over Height including back cushions', () => {
    const item = { ...sofa, measurements: [...sofa.measurements, measure('Height', 0.85)] };
    expect(toProduct(item, false)).toMatchObject({ product: { dims: { h: 0.85 } } });
  });

  it('rejects sofas without an overall height', () => {
    const item = { ...sofa, measurements: sofa.measurements.slice(0, 3) };
    expect(toProduct(item, false)).toEqual({
      ok: false,
      reason: 'no Height or Height including back cushions',
    });
  });

  it('uses the largest extent of a range', () => {
    const width = { name: 'Width', text: '200-240 cm', minM: 2.0, maxM: 2.4 };
    const item = { ...sofa, measurements: [width, ...sofa.measurements.slice(1)] };
    expect(toProduct(item, false)).toMatchObject({ product: { dims: { w: 2.4 } } });
  });

  it('marks products with a downloaded model as ikea', () => {
    expect(toProduct(sofa, true)).toMatchObject({ product: { modelSource: 'ikea' } });
  });

  it('skips items outside the mapped categories', () => {
    expect(toProduct({ ...sofa, categoryPath: [{ id: 'fu002', name: 'Chairs' }] }, false)).toBe(
      undefined,
    );
  });

  it('rejects prices that are not in CAD', () => {
    expect(toProduct({ ...sofa, currency: 'USD' }, false)).toEqual({
      ok: false,
      reason: 'price not in CAD (USD)',
    });
  });

  it('rejects items that fail the Product schema', () => {
    const result = toProduct({ ...sofa, articleNo: '59442483' }, false);
    expect(result?.ok).toBe(false);
  });
});

describe('itemNoOf', () => {
  it('drops the dots', () => {
    expect(itemNoOf({ articleNo: '594.424.83' })).toBe('59442483');
  });
});
