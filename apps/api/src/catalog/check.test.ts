import type { ModelManifestEntry } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { product } from '../test/fixtures';
import { productProblems } from './check';

/** A manifest entry for a model whose bounds are `size`, centered at the bottom. */
const model = (
  size: [number, number, number],
  source: ModelManifestEntry['source'] = 'ikea',
): ModelManifestEntry => ({
  itemNo: '11111111',
  category: 'sofa',
  outcome: 'fitted',
  source,
  bytes: 1000,
  scale: [1, 1, 1],
  notes: [],
  bounds: { min: [-size[0] / 2, 0, -size[2] / 2], max: [size[0] / 2, size[1], size[2] / 2] },
  inputs: '',
});

describe('productProblems', () => {
  const sofa = product('111.111.11');

  it('passes a product with a true-to-size model', () => {
    expect(productProblems(sofa, model([2, 0.8, 0.9]))).toEqual([]);
  });

  it('flags a model off its listed size, or not standing on its origin', () => {
    expect(productProblems(sofa, model([2.1, 0.8, 0.9]))).toEqual([
      'model is off its listed size by 10 cm',
    ]);
    const lifted = { ...model([2, 0.8, 0.9]), bounds: { min: [-1, 0.1, -0.45], max: [1, 0.9, 0.45] } };
    expect(productProblems(sofa, lifted as ModelManifestEntry)).toEqual([
      'model origin is not at its bottom center',
    ]);
  });

  it('lets a round product reach its diameter on its wider side only', () => {
    const lamp = product('222.222.22', {
      category: 'floor_lamp',
      shape: 'round',
      dims: { w: 0.4, d: 0.4, h: 1.5 },
    });
    expect(productProblems(lamp, model([0.3, 1.5, 0.4]))).toEqual([]);
  });

  it('flags products without a model', () => {
    expect(productProblems(sofa, undefined)).toEqual(['no model']);
    expect(productProblems(sofa, model([2, 0.8, 0.9], null))).toEqual(['no model']);
  });

  it('flags implausible sizes, prices and links', () => {
    const bad = product('333.333.33', {
      priceCad: 0,
      url: 'https://example.com/sofa',
      dims: { w: 20, d: 0.9, h: 2.6 },
    });
    expect(productProblems(bad, model([20, 2.6, 0.9]))).toEqual([
      'no price',
      'not an IKEA.ca product link',
      'w = 20 m is outside 0.7–4.2 m',
      'h = 2.6 m is outside 0.5–1.3 m',
      'taller than the 2.44 m default ceiling',
    ]);
  });
});
