import { describe, expect, it } from 'vitest';
import { fitSize } from './upload';

describe('fitSize', () => {
  it('scales a large plan down to 3,000 px on its longest side', () => {
    expect(fitSize(5671, 7383)).toEqual({ width: 2304, height: 3000 });
    expect(fitSize(6000, 1500)).toEqual({ width: 3000, height: 750 });
  });

  it('leaves smaller plans alone', () => {
    expect(fitSize(1200, 900)).toEqual({ width: 1200, height: 900 });
  });
});
