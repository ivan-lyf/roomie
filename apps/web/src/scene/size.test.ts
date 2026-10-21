import { describe, expect, it } from 'vitest';
import { sizeError } from './size';

describe('sizeError', () => {
  it('compares x/y/z to w/h/d', () => {
    expect(sizeError([2.24, 0.92, 0.95], { w: 2.24, d: 0.95, h: 0.92 })).toBe(0);
  });

  it('returns the largest difference', () => {
    expect(sizeError([2.2, 0.9, 0.95], { w: 2.24, d: 0.95, h: 0.92 })).toBeCloseTo(0.04, 9);
  });
});
