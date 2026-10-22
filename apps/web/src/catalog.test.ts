import type { Product } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { groupFamilies, optionChoices, pickVariant } from './catalog';

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
