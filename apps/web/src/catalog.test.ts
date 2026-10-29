import type { Product } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { groupFamilies, matchesFilter, optionChoices, pickVariant, swapOptions } from './catalog';

const product = (
  articleNo: string,
  familyId: string,
  name: string,
  priceCad: number,
  options: Record<string, string> = {},
): Product => ({
  articleNo,
  familyId,
  options: Object.entries(options).map(([n, value]) => ({ name: n, value })),
  name,
  category: 'bed',
  status: 'active',
  priceCad,
  url: `https://www.ikea.com/ca/en/p/test-${articleNo.replaceAll('.', '')}/`,
  imageUrl: null,
  color: 'white',
  material: null,
  dims: { w: 1.6, d: 2.1, h: 1 },
  shape: 'rect',
  extendedW: null,
  modelUrl: null,
  modelSource: 'procedural',
  styleTags: [],
  scrapedAt: new Date('2026-10-21T00:00:00Z'),
});

const queenWhite = product('100.000.01', '100.000.01', 'MALM Bed frame - white Queen', 299, {
  Color: 'White',
  Size: 'Queen',
});
const kingWhite = product('100.000.02', '100.000.01', 'MALM Bed frame - white King', 349, {
  Color: 'White',
  Size: 'King',
});
const queenOak = product('100.000.03', '100.000.01', 'MALM Bed frame - oak Queen', 329, {
  Color: 'Oak',
  Size: 'Queen',
});
const kingOak = product('100.000.04', '100.000.01', 'MALM Bed frame - oak King', 379, {
  Color: 'Oak',
  Size: 'King',
});
const malm = [kingOak, queenWhite, kingWhite, queenOak];

describe('groupFamilies', () => {
  it('groups by family, names it without the variant, and sorts variants by price', () => {
    const daybed = product('200.000.01', '200.000.01', 'HEMNES Daybed - white', 549);
    const families = groupFamilies([...malm, daybed]);
    expect(families.map((f) => f.name)).toEqual(['HEMNES Daybed', 'MALM Bed frame']);
    expect(families[1]?.variants.map((v) => v.priceCad)).toEqual([299, 329, 349, 379]);
  });
});

describe('optionChoices', () => {
  it('lists the options that vary, with their values', () => {
    const single = product('300.000.01', '300.000.01', 'LACK - black', 30, { Color: 'Black' });
    expect(optionChoices(malm)).toEqual([
      { name: 'Color', values: ['Oak', 'White'] },
      { name: 'Size', values: ['King', 'Queen'] },
    ]);
    expect(optionChoices([single])).toEqual([]);
  });
});

describe('pickVariant', () => {
  it('changes one option and keeps the others', () => {
    expect(pickVariant(malm, queenWhite, 'Color', 'Oak')).toBe(queenOak);
    expect(pickVariant(malm, queenOak, 'Size', 'King')).toBe(kingOak);
  });

  it('finds no variant for a value nobody has', () => {
    expect(pickVariant(malm, queenWhite, 'Color', 'Black')).toBeUndefined();
  });
});

describe('matchesFilter', () => {
  const bed = product('100.000.01', '100.000.01', 'MALM Bed frame', 399);

  it('keeps products within the price and size limits', () => {
    expect(matchesFilter(bed, {})).toBe(true);
    expect(matchesFilter(bed, { maxPrice: 399, maxWidth: 1.6, maxDepth: 2.1 })).toBe(true);
    expect(matchesFilter(bed, { maxPrice: 300 })).toBe(false);
    expect(matchesFilter(bed, { maxWidth: 1.5 })).toBe(false);
    expect(matchesFilter(bed, { maxDepth: 2 })).toBe(false);
  });

  it('keeps products that fit the room either way round', () => {
    expect(matchesFilter(bed, { room: { w: 2.5, d: 1.8 } })).toBe(true);
    expect(matchesFilter(bed, { room: { w: 1.5, d: 3.0 } })).toBe(false);
  });
});

describe('swapOptions', () => {
  const current = product('100.000.01', 'f1', 'MALM Bed frame - white Queen', 299);
  const sized = (articleNo: string, w: number, d: number, price = 299): Product => ({
    ...product(articleNo, 'f2', 'TEST Bed frame', price),
    dims: { w, d, h: 1 },
  });
  const close = sized('200.000.01', 1.8, 2.1);
  const wide = sized('200.000.02', 1.81, 2.1);
  const dear = sized('200.000.03', 1.5, 2.0, 899);
  const sofa: Product = { ...sized('200.000.04', 1.6, 2.1), category: 'sofa' };
  const gone: Product = { ...sized('200.000.05', 1.6, 2.1), status: 'discontinued' };
  const all = [current, close, wide, dear, sofa, gone];
  const ids = (ps: Product[]) => ps.map((p) => p.articleNo);

  it('offers others of its category still sold, within 20 cm of its size', () => {
    expect(ids(swapOptions(current, all))).toEqual(['200.000.01', '200.000.03']);
  });

  it('offers every size on request, within the price limit', () => {
    expect(ids(swapOptions(current, all, { anySize: true }))).toEqual([
      '200.000.01',
      '200.000.02',
      '200.000.03',
    ]);
    expect(ids(swapOptions(current, all, { anySize: true, maxPrice: 300 }))).toEqual([
      '200.000.01',
      '200.000.02',
    ]);
  });
});
