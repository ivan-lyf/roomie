import type { Vec2 } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import {
  area,
  bounds,
  centroid,
  contains,
  mergePolygons,
  signedArea,
  splitPolygon,
} from './polygon';

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

describe('splitPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ];

  it('cuts a room in two along a line drawn across it', () => {
    const [one, two] = splitPolygon(square, { x: 1.5, y: -1 }, { x: 1.5, y: 4 })!;
    expect(area(one) + area(two)).toBeCloseTo(12, 9);
    expect([area(one), area(two)].sort()).toEqual([4.5, 7.5]);
  });

  it('needs a line that crosses the outline twice', () => {
    expect(splitPolygon(square, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeUndefined();
    expect(splitPolygon(square, { x: 1, y: -1 }, { x: 1, y: 1 })).toBeUndefined();
  });

  it('cuts through a corner', () => {
    const halves = splitPolygon(square, { x: -1, y: -1 }, { x: 5, y: 5 });
    expect(halves).toBeDefined();
    expect(halves!.map(area).reduce((s, a) => s + a, 0)).toBeCloseTo(12, 9);
  });
});

describe('mergePolygons', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  it('joins rooms sharing a whole edge into one rectangle', () => {
    const merged = mergePolygons(rect(0, 0, 4, 3), rect(4, 0, 6, 3))!;
    expect(merged).toHaveLength(4);
    expect(area(merged)).toBe(18);
  });

  it('joins rooms sharing part of an edge into an L', () => {
    // The demo's living room (4.5 deep) and bedroom (3.5 deep) share the top of w5.
    const merged = mergePolygons(rect(0.5, 0.5, 4, 4), rect(4, 0.5, 8.5, 4.6))!;
    expect(merged).toHaveLength(6);
    expect(area(merged)).toBeCloseTo(3.5 * 3.5 + 4.5 * 4.1, 9);
  });

  it("won't join rooms that don't touch along an edge", () => {
    expect(mergePolygons(rect(0, 0, 1, 1), rect(2, 0, 3, 1))).toBeUndefined();
    expect(mergePolygons(rect(0, 0, 1, 1), rect(1, 1, 2, 2))).toBeUndefined();
  });
});
