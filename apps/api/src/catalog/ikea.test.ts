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
  description: 'Sofa, Kilanda light beige',
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

/** An item in one IKEA category, with a product type and measurements in meters. */
const item = (
  categoryId: string,
  description: string,
  measurements: Record<string, number>,
): IkeaItem => ({
  ...sofa,
  description,
  categoryPath: [{ id: categoryId, name: 'Test category' }],
  measurements: Object.entries(measurements).map(([name, m]) => measure(name, m)),
});

function imported(i: IkeaItem) {
  const result = toProduct(i, false);
  if (!result) throw new Error('outside the mapped categories');
  if (!result.ok) throw new Error(result.reason);
  return result.product;
}

const rejection = (i: IkeaItem) => {
  const result = toProduct(i, false);
  return result && !result.ok ? result.reason : undefined;
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
        shape: 'rect',
        extendedW: null,
        modelSource: 'procedural',
        modelUrl: null,
      },
    });
  });

  it('uses the taller of Height and Height including back cushions', () => {
    const item = { ...sofa, measurements: [...sofa.measurements, measure('Height', 0.85)] };
    expect(toProduct(item, false)).toMatchObject({ product: { dims: { h: 0.92 } } });
  });

  it('rejects sofas without an overall height', () => {
    const item = { ...sofa, measurements: sofa.measurements.slice(0, 3) };
    expect(toProduct(item, false)).toEqual({
      ok: false,
      category: 'sofa',
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

  it('keeps the image url', () => {
    const imageUrl = 'https://www.ikea.com/ca/en/images/products/uppland-sofa__0818565_pe774489_s5.jpg';
    expect(imported({ ...sofa, imageUrl }).imageUrl).toBe(imageUrl);
  });

  it('skips items outside the mapped categories', () => {
    expect(toProduct({ ...sofa, categoryPath: [{ id: 'fu002', name: 'Chairs' }] }, false)).toBe(
      undefined,
    );
  });

  it('rejects prices that are not in CAD', () => {
    expect(toProduct({ ...sofa, currency: 'USD' }, false)).toEqual({
      ok: false,
      category: 'sofa',
      reason: 'price not in CAD (USD)',
    });
  });

  it('rejects items that fail the Product schema', () => {
    const result = toProduct({ ...sofa, articleNo: '59442483' }, false);
    expect(result?.ok).toBe(false);
  });
});

describe('category rules', () => {
  const L_SHAPED = 'L- or T-shaped (not supported yet)';
  const PART = 'part, add-on or other product type';

  it('leaves out L-shaped pieces, by product type or by measurements', () => {
    expect(rejection({ ...sofa, description: 'Sofa with chaise, Gunnared beige' })).toBe(L_SHAPED);
    expect(rejection(item('31786', 'Sectional, 4-seat', { 'Width left': 2.5 }))).toBe(L_SHAPED);
    expect(rejection(item('20649', 'L-shaped desk, white', {}))).toBe(L_SHAPED);
    expect(rejection(item('20649', 'Desk combination, white', {}))).toBe(L_SHAPED);
  });

  it('skips parts and add-ons', () => {
    expect(rejection(item('31786', 'Sofa section, Tonerud red', {}))).toBe(PART);
    expect(rejection(item('10382', 'Glass door, white', {}))).toBe(PART);
    expect(rejection(item('20649', 'Tabletop, white', { Length: 1, Width: 0.6 }))).toBe(PART);
  });

  it('uses the length of a bed as its depth and its tallest board as its height', () => {
    const bed = item('bm003', 'Bed frame, white', {
      Width: 1.6,
      Length: 2.06,
      'Headboard height': 1.0,
      'Footboard height': 0.4,
    });
    expect(imported(bed)).toMatchObject({ category: 'bed', dims: { w: 1.6, d: 2.06, h: 1.0 } });
  });

  it('reads round tables from their diameter', () => {
    const table = item('21825', 'Table, white', { Diameter: 1.1, Height: 0.75 });
    expect(imported(table)).toMatchObject({ shape: 'round', dims: { w: 1.1, d: 1.1, h: 0.75 } });
  });

  it('stores the extended length of extendable tables', () => {
    const table = item('21825', 'Extendable table, white', {
      Length: 1.3,
      'Max. length': 1.9,
      Width: 0.8,
      Height: 0.75,
    });
    expect(imported(table)).toMatchObject({ dims: { w: 1.3, d: 0.8, h: 0.75 }, extendedW: 1.9 });
    const nesting = item('10716', 'Nesting tables, set of 2', {
      'Max. length': 0.9,
      Width: 0.5,
      Height: 0.45,
    });
    expect(imported(nesting)).toMatchObject({ dims: { w: 0.9, d: 0.5, h: 0.45 }, extendedW: null });
  });

  it('reads desks listed as Length x Width or as Width x Depth', () => {
    const table = item('20649', 'Table, white', { Length: 1.0, Width: 0.6, Height: 0.74 });
    expect(imported(table)).toMatchObject({ category: 'desk', dims: { w: 1.0, d: 0.6, h: 0.74 } });
    const sitStand = item('20649', 'Desk sit/stand, white', {
      Width: 1.4,
      Depth: 0.7,
      'Min. height': 0.65,
      'Max. height': 1.25,
    });
    expect(imported(sitStand)).toMatchObject({ dims: { w: 1.4, d: 0.7, h: 0.65 } });
  });

  it('gives rugs without a listed thickness a default one', () => {
    const rug = item('10653', 'Rug, low pile', { Length: 2.0, Width: 1.4 });
    expect(imported(rug)).toMatchObject({ category: 'rug', dims: { w: 2.0, d: 1.4, h: 0.01 } });
    const round = item('10653', 'Rug, flatwoven', { Diameter: 1.2, Thickness: 0.008 });
    expect(imported(round)).toMatchObject({ shape: 'round', dims: { w: 1.2, d: 1.2, h: 0.008 } });
  });

  it('makes floor lamps round and as wide as their shade or base', () => {
    const lamp = item('10731', 'Floor lamp, white', {
      Height: 1.5,
      'Shade diameter': 0.4,
      'Base diameter': 0.28,
    });
    expect(imported(lamp)).toMatchObject({ shape: 'round', dims: { w: 0.4, d: 0.4, h: 1.5 } });
    const arm = item('10731', 'Floor/reading lamp, black', {
      Length: 0.76,
      Width: 0.28,
      Height: 1.53,
    });
    expect(imported(arm)).toMatchObject({ shape: 'rect', dims: { w: 0.76, d: 0.28, h: 1.53 } });
    const arc = item('10731', 'Floor lamp, arched', {
      Length: 1.2,
      'Shade diameter': 0.38,
      'Base diameter': 0.3,
      Height: 1.9,
    });
    expect(imported(arc)).toMatchObject({ shape: 'rect', dims: { w: 1.2, d: 0.38, h: 1.9 } });
  });
});

describe('itemNoOf', () => {
  it('drops the dots', () => {
    expect(itemNoOf({ articleNo: '594.424.83' })).toBe('59442483');
  });
});
