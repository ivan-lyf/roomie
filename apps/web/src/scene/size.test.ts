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

describe('sizeError for round products', () => {
  it('only needs the wider side to reach the diameter', () => {
    expect(sizeError([0.5, 1.5, 0.62], { w: 0.62, d: 0.62, h: 1.5 }, 'round')).toBeCloseTo(0, 9);
    expect(sizeError([0.5, 1.5, 0.62], { w: 0.62, d: 0.62, h: 1.5 })).toBeCloseTo(0.12, 9);
  });
});
