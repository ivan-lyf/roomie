import { describe, expect, it } from 'vitest';
import { chooseYaw, type Donor, pickDonor, scaleChange } from './fit';

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

describe('pickDonor', () => {
  const sofa = {
    category: 'sofa' as const,
    dims: { w: 2, d: 0.9, h: 0.8 },
    shape: 'rect' as const,
  };

  it('takes the sibling whose model fits best', () => {
    const donors = [
      { itemNo: '30000000', rawSize: [2.3, 0.8, 0.9] },
      { itemNo: '20000000', rawSize: [2, 0.8, 0.9] },
    ] satisfies Donor[];
    expect(pickDonor(sofa, donors, 0.25)).toMatchObject({ itemNo: '20000000', change: 0 });
  });

  it('skips siblings beyond the scale limit', () => {
    expect(pickDonor(sofa, [{ itemNo: '1', rawSize: [3, 0.8, 0.9] }], 0.25)).toBeUndefined();
  });

  it('turns a rug model when that fits', () => {
    const rug = {
      category: 'rug' as const,
      dims: { w: 2, d: 1.4, h: 0.01 },
      shape: 'rect' as const,
    };
    expect(pickDonor(rug, [{ itemNo: '1', rawSize: [1.4, 0.01, 2] }], 0.25)?.change).toBeCloseTo(0);
  });

  it('breaks ties by item number', () => {
    const same: [number, number, number] = [2, 0.8, 0.9];
    const donors = [
      { itemNo: '20000000', rawSize: same },
      { itemNo: '10000000', rawSize: same },
    ];
    expect(pickDonor(sofa, donors, 0.25)?.itemNo).toBe('10000000');
  });
});
