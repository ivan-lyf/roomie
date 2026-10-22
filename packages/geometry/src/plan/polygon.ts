import type { Vec2 } from '@roomie/schema';

/**
 * Signed area by the shoelace formula. With y pointing down the page, it's positive when the
 * points run clockwise as drawn.
 */
export function signedArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function area(points: readonly Vec2[]): number {
  return Math.abs(signedArea(points));
}

/** The center of the polygon's area (the average of its points if it has none). */
export function centroid(points: readonly Vec2[]): Vec2 {
  const a = signedArea(points);
  if (a === 0) {
    const n = Math.max(points.length, 1);
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const cross = p.x * q.y - q.x * p.y;
    x += (p.x + q.x) * cross;
    y += (p.y + q.y) * cross;
  }
  return { x: x / (6 * a), y: y / (6 * a) };
}

/** Whether a point is inside the polygon (even-odd rule); points on an edge may go either way. */
export function contains(points: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function bounds(points: readonly Vec2[]): { min: Vec2; max: Vec2 } {
  return {
    min: { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) },
    max: { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)) },
  };
}
