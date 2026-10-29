import type { Placement, Product, Vec2 } from '@roomie/schema';
import polygonClipping, { type Geom, type MultiPolygon } from 'polygon-clipping';
import { area, bounds, contains } from '../plan/polygon';
import { localToPlan } from '../transform';

// Shapes on the floor, in plan space: what an item covers, and how two shapes meet. Items and
// their zones are convex, so most tests are a separating-axis check; the floor of an L-shaped
// room and a drawn obstacle can be concave, and go through polygon clipping.

/** Sides of the polygon standing in for a round product's footprint. */
const ROUND_SIDES = 24;

/** What validation needs to know about a product. */
export type ProductFit = Pick<Product, 'category' | 'dims' | 'shape'>;

/** A rectangle in an item's own floor space (x along its width, y to its front), on the plan. */
export function localRect(
  placement: Pick<Placement, 'x' | 'y' | 'rotation'>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Vec2[] {
  const at = (x: number, y: number) => localToPlan({ x, y }, placement, placement.rotation);
  return [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
}

/** The floor an item covers: its rectangle, or a 24-sided polygon for a round one. */
export function itemOutline(
  placement: Pick<Placement, 'x' | 'y' | 'rotation'>,
  product: Pick<Product, 'dims' | 'shape'>,
): Vec2[] {
  const { w, d } = product.dims;
  if (product.shape === 'round') {
    return Array.from({ length: ROUND_SIDES }, (_, i) => {
      const t = (2 * Math.PI * i) / ROUND_SIDES;
      const local = { x: (w / 2) * Math.cos(t), y: (d / 2) * Math.sin(t) };
      return localToPlan(local, placement, placement.rotation);
    });
  }
  return localRect(placement, -w / 2, -d / 2, w / 2, d / 2);
}

/** How far an item reaches from its center along a direction (a unit vector). */
export function reach(product: Pick<Product, 'dims' | 'shape'>, rotation: number, n: Vec2): number {
  if (product.shape === 'round') return product.dims.w / 2;
  const across = { x: Math.cos(rotation), y: -Math.sin(rotation) };
  const front = { x: Math.sin(rotation), y: Math.cos(rotation) };
  const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
  return (Math.abs(dot(across, n)) * product.dims.w + Math.abs(dot(front, n)) * product.dims.d) / 2;
}

/** A wall's body: the rectangle around its center line, as thick as the wall. */
export function wallOutline(wall: { a: Vec2; b: Vec2; thickness: number }): Vec2[] {
  const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) || 1;
  const n = {
    x: ((wall.b.y - wall.a.y) / length) * (wall.thickness / 2),
    y: (-(wall.b.x - wall.a.x) / length) * (wall.thickness / 2),
  };
  return [
    { x: wall.a.x + n.x, y: wall.a.y + n.y },
    { x: wall.b.x + n.x, y: wall.b.y + n.y },
    { x: wall.b.x - n.x, y: wall.b.y - n.y },
    { x: wall.a.x - n.x, y: wall.a.y - n.y },
  ];
}

/** A shape with its bounding box worked out once, since it's tested against many others. */
export type Shape = { points: Vec2[]; box: { min: Vec2; max: Vec2 }; convex: boolean };

export function shape(points: Vec2[]): Shape {
  return { points, box: bounds(points), convex: isConvex(points) };
}

export function isConvex(points: readonly Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const n = points.length;
    const [a, b, c] = [points[i]!, points[(i + 1) % n]!, points[(i + 2) % n]!];
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(turn) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(turn);
    else if (Math.sign(turn) !== sign) return false;
  }
  return true;
}

function project(points: readonly Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const t = p.x * axis.x + p.y * axis.y;
    min = Math.min(min, t);
    max = Math.max(max, t);
  }
  return [min, max];
}

/**
 * How deep two convex polygons overlap: the least either would have to move to clear the other.
 * Zero or less when they only touch or are apart.
 */
export function penetration(a: readonly Vec2[], b: readonly Vec2[]): number {
  let least = Infinity;
  for (const points of [a, b]) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const q = points[(i + 1) % points.length]!;
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      if (length < 1e-12) continue;
      const axis = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
      const [a0, a1] = project(a, axis);
      const [b0, b1] = project(b, axis);
      const overlap = Math.min(a1, b1) - Math.max(a0, b0);
      if (overlap <= 0) return overlap;
      least = Math.min(least, overlap);
    }
  }
  return least;
}

const toGeom = (points: readonly Vec2[]): Geom => [points.map((p): [number, number] => [p.x, p.y])];

/** The area of a clipping result: each outer ring less its holes. */
function multiArea(result: MultiPolygon): number {
  let sum = 0;
  for (const polygon of result) {
    polygon.forEach((ring, i) => {
      const a = area(ring.slice(0, -1).map(([x, y]) => ({ x, y })));
      sum += i === 0 ? a : -a;
    });
  }
  return sum;
}

/**
 * Whether two shapes overlap by more than `tolerance` meters. Convex pairs are measured by how
 * deep they overlap; a concave shape by the area they share, more than `tolerance` squared.
 */
export function overlaps(a: Shape, b: Shape, tolerance: number): boolean {
  if (
    a.box.max.x - b.box.min.x <= tolerance ||
    b.box.max.x - a.box.min.x <= tolerance ||
    a.box.max.y - b.box.min.y <= tolerance ||
    b.box.max.y - a.box.min.y <= tolerance
  ) {
    return false;
  }
  if (a.convex && b.convex) return penetration(a.points, b.points) > tolerance;
  let shared: number;
  try {
    shared = multiArea(polygonClipping.intersection(toGeom(a.points), toGeom(b.points)));
  } catch {
    shared = sampledArea(a.points, (p) => contains(b.points, p));
  }
  return shared > tolerance * tolerance;
}

/** The area of `inner` outside `outer`. */
export function areaOutside(inner: readonly Vec2[], outer: readonly Vec2[]): number {
  try {
    return multiArea(polygonClipping.difference(toGeom(inner), toGeom(outer)));
  } catch {
    return sampledArea(inner, (p) => !contains(outer, p));
  }
}

/** Points per side of the grid `sampledArea` measures with. */
const SAMPLES = 12;

/**
 * Roughly the area of the part of a polygon where `test` holds, from a grid of points over it:
 * for the rare shapes polygon clipping can't handle (it throws on some near-degenerate rings).
 */
export function sampledArea(polygon: readonly Vec2[], test: (p: Vec2) => boolean): number {
  const { min, max } = bounds(polygon);
  let [inside, hit] = [0, 0];
  for (let i = 0; i < SAMPLES; i++) {
    for (let j = 0; j < SAMPLES; j++) {
      const p = {
        x: min.x + ((i + 0.5) / SAMPLES) * (max.x - min.x),
        y: min.y + ((j + 0.5) / SAMPLES) * (max.y - min.y),
      };
      if (!contains(polygon, p)) continue;
      inside++;
      if (test(p)) hit++;
    }
  }
  return inside === 0 ? 0 : (hit / inside) * area(polygon);
}
