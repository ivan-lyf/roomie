import { getBounds } from '@gltf-transform/functions';
import { Category, type Dims, type ProductShape } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { BACKED } from './fit';
import { facesBackwards, topBandCenterZ } from './normalize';
import { palette, standInModel } from './procedural';

/** Typical listed sizes, in meters. */
const DIMS: Record<Category, Dims> = {
  bed: { w: 1.6, d: 2.1, h: 1.0 },
  sofa: { w: 2.2, d: 0.9, h: 0.85 },
  armchair: { w: 0.8, d: 0.85, h: 0.95 },
  coffee_table: { w: 1.2, d: 0.6, h: 0.45 },
  dining_table: { w: 1.6, d: 0.9, h: 0.75 },
  dining_chair: { w: 0.45, d: 0.5, h: 0.85 },
  desk: { w: 1.4, d: 0.7, h: 0.74 },
  desk_chair: { w: 0.65, d: 0.65, h: 1.1 },
  shelving: { w: 0.8, d: 0.3, h: 2.0 },
  wardrobe: { w: 1.5, d: 0.6, h: 2.36 },
  dresser: { w: 0.8, d: 0.48, h: 1.0 },
  nightstand: { w: 0.45, d: 0.4, h: 0.55 },
  tv_unit: { w: 1.8, d: 0.42, h: 0.48 },
  rug: { w: 2.0, d: 1.4, h: 0.01 },
  floor_lamp: { w: 0.76, d: 0.28, h: 1.53 },
};
const ROUND: Category[] = ['coffee_table', 'dining_table', 'nightstand', 'rug', 'floor_lamp'];

const cases: [Category, ProductShape, Dims][] = Category.options.flatMap((category) => {
  const dims = DIMS[category];
  const round: Dims = { w: dims.d, d: dims.d, h: dims.h };
  return [
    [category, 'rect', dims] as [Category, ProductShape, Dims],
    ...(ROUND.includes(category) ? [[category, 'round', round] as [Category, ProductShape, Dims]] : []),
  ];
});

describe('standInModel', () => {
  it.each(cases)('fills the listed size of a %s (%s), origin at the bottom center', (category, shape, dims) => {
    const doc = standInModel(category, dims, shape, 'white');
    const { min, max } = getBounds(doc.getRoot().getDefaultScene()!);
    const expected = { min: [-dims.w / 2, 0, -dims.d / 2], max: [dims.w / 2, dims.h, dims.d / 2] };
    expected.min.forEach((v, i) => expect(min[i]).toBeCloseTo(v, 6));
    expected.max.forEach((v, i) => expect(max[i]).toBeCloseTo(v, 6));
  });

  it.each([...BACKED])('puts the back of a %s at -Z', (category) => {
    const dims = DIMS[category];
    const doc = standInModel(category, dims, 'rect', null);
    expect(topBandCenterZ(doc)).toBeLessThan(0);
    expect(facesBackwards(doc, dims.d)).toBe(false);
  });

  it('copes with a bed too low for a mattress', () => {
    const doc = standInModel('bed', { w: 1, d: 1.95, h: 0.23 }, 'rect', null);
    const { max } = getBounds(doc.getRoot().getDefaultScene()!);
    expect(max[1]).toBeCloseTo(0.23, 6);
  });
});

describe('palette', () => {
  it('takes the body from the first color and the legs from the second', () => {
    expect(palette('beige, brown')).toMatchObject({ body: '#d6c4a3', accent: '#7a5a3e' });
  });

  it('darkens the body for legs, and falls back to a neutral without a color', () => {
    expect(palette('white')).toMatchObject({ body: '#ebe9e4', accent: '#81807d' });
    expect(palette(null).body).toBe('#b5b0a8');
  });
});
