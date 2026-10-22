import type { Vec2 } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { area, bounds, centroid, contains, signedArea } from './polygon';

const P = (x: number, y: number): Vec2 => ({ x, y });
const square = [P(0, 0), P(2, 0), P(2, 2), P(0, 2)];
// An L: a 2 x 2 square with the 1 x 1 top-right quarter missing.
const ell = [P(0, 0), P(1, 0), P(1, 1), P(2, 1), P(2, 2), P(0, 2)];

describe('polygon', () => {
  it('measures area, positive when clockwise as drawn (y down)', () => {
    expect(signedArea(square)).toBe(4);
    expect(signedArea(square.toReversed())).toBe(-4);
    expect(area(ell)).toBe(3);
  });

  it('finds the center of the area', () => {
    expect(centroid(square)).toEqual({ x: 1, y: 1 });
    const c = centroid(ell);
    expect(c.x).toBeCloseTo(0.8333, 4);
    expect(c.y).toBeCloseTo(1.1667, 4);
  });

  it('tells inside from outside, including the notch of an L', () => {
    expect(contains(ell, P(0.5, 0.5))).toBe(true);
    expect(contains(ell, P(1.5, 0.5))).toBe(false);
    expect(contains(ell, P(1.5, 1.5))).toBe(true);
    expect(contains(ell, P(3, 1))).toBe(false);
  });

  it('finds the bounding box', () => {
    expect(bounds(ell)).toEqual({ min: P(0, 0), max: P(2, 2) });
  });
});
