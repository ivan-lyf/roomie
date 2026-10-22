import { describe, expect, it } from 'vitest';
import { chooseYaw, scaleChange } from './fit';

describe('scaleChange', () => {
  it('counts every axis for most categories', () => {
    expect(scaleChange([1, 1.3, 0.95], 'sofa')).toBeCloseTo(0.3);
  });

  it('ignores the height of rugs, which is often a default', () => {
    expect(scaleChange([1, 2, 0.95], 'rug')).toBeCloseTo(0.05);
  });
});

describe('chooseYaw', () => {
  const rug = { category: 'rug' as const, dims: { w: 2, d: 1.4, h: 0.01 }, shape: 'rect' as const };

  it('turns a rug modeled with its long side along Z', () => {
    expect(chooseYaw([1.4, 0.01, 2], rug)).toBeCloseTo(Math.PI / 2);
  });

  it('keeps a model that already fits', () => {
    expect(chooseYaw([2, 0.01, 1.4], rug)).toBe(0);
  });

  it('never turns products with a front', () => {
    const sofa = { ...rug, category: 'sofa' as const, dims: { w: 2, d: 0.9, h: 0.8 } };
    expect(chooseYaw([0.9, 0.8, 2], sofa)).toBe(0);
  });
});
