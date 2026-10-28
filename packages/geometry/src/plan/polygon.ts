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

/**
 * A point well inside the polygon: its centroid when that's inside, else (an L or a U, whose
 * centroid can fall outside it) the middle of the widest stretch inside it across the centroid's
 * height, or across the middle of its bounds.
 */
export function interiorPoint(points: readonly Vec2[]): Vec2 {
  const c = centroid(points);
  if (contains(points, c)) return c;
  const { min, max } = bounds(points);
  for (const y of [c.y, (min.y + max.y) / 2]) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((u, v) => u - v);
    let best: Vec2 | undefined;
    let widest = 0;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1]! - xs[i]! > widest) {
        widest = xs[i + 1]! - xs[i]!;
        best = { x: (xs[i]! + xs[i + 1]!) / 2, y };
      }
    }
    if (best) return best;
  }
  return c;
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

const near = (a: Vec2, b: Vec2, tolerance: number) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

/** Where segments `p→q` and `a→b` cross, as fractions along each, if they do. */
function crossing(p: Vec2, q: Vec2, a: Vec2, b: Vec2): { t: number; u: number } | undefined {
  const r = { x: q.x - p.x, y: q.y - p.y };
  const s = { x: b.x - a.x, y: b.y - a.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return undefined;
  const t = ((a.x - p.x) * s.y - (a.y - p.y) * s.x) / denom;
  const u = ((a.x - p.x) * r.y - (a.y - p.y) * r.x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : undefined;
}

/** Drops repeated points and points in the middle of a straight run. */
export function simplify(points: readonly Vec2[], tolerance = 1e-6): Vec2[] {
  let out = points.filter((p, i) => !near(p, points[(i + 1) % points.length]!, tolerance));
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length]!;
      const b = out[i]!;
      const c = out[(i + 1) % out.length]!;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) <= tolerance * Math.max(Math.hypot(c.x - a.x, c.y - a.y), 1)) {
        out = out.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * Cuts a polygon in two along the segment `a→b`, which has to cross its outline exactly twice
 * (draw the line from outside to outside). Undefined when it doesn't.
 */
export function splitPolygon(
  points: readonly Vec2[],
  a: Vec2,
  b: Vec2,
): [Vec2[], Vec2[]] | undefined {
  const hits: { edge: number; t: number; point: Vec2 }[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const hit = crossing(a, b, p, q);
    if (!hit || hit.u === 1) continue; // A corner belongs to the edge it starts.
    const point = { x: p.x + (q.x - p.x) * hit.u, y: p.y + (q.y - p.y) * hit.u };
    if (hits.some((h) => near(h.point, point, 1e-9))) continue;
    hits.push({ edge: i, t: hit.t, point });
  }
  if (hits.length !== 2) return undefined;
  const [first, second] = hits as [(typeof hits)[0], (typeof hits)[0]];
  const run = (from: (typeof hits)[0], to: (typeof hits)[0]) => {
    const out = [from.point];
    for (let i = (from.edge + 1) % points.length; ; i = (i + 1) % points.length) {
      out.push(points[i]!);
      if (i === to.edge) break;
    }
    out.push(to.point);
    return simplify(out);
  };
  const one = run(first, second);
  const two = run(second, first);
  if (one.length < 3 || two.length < 3 || area(one) < 1e-9 || area(two) < 1e-9) return undefined;
  return [one, two];
}

/** Adds the points of `others` that lie on the polygon's edges, so shared edges match up. */
function withPointsOnEdges(points: readonly Vec2[], others: readonly Vec2[], tolerance: number) {
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    out.push(p);
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len === 0) continue;
    const d = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    const inner = others
      .map((o) => ({ o, t: (o.x - p.x) * d.x + (o.y - p.y) * d.y }))
      .filter(({ o, t }) => {
        const across = Math.abs((o.x - p.x) * d.y - (o.y - p.y) * d.x);
        return across <= tolerance && t > tolerance && t < len - tolerance;
      })
      .sort((u, v) => u.t - v.t);
    for (const { o } of inner) out.push({ ...o });
  }
  return out;
}

/**
 * Joins two polygons that share part of their outline into one. Undefined when they don't
 * touch along an edge, or joining them would leave a hole.
 */
export function mergePolygons(
  p: readonly Vec2[],
  q: readonly Vec2[],
  tolerance = 0.02,
): Vec2[] | undefined {
  // Same winding for both, and q's points snapped onto p's where they're the same corner.
  const wind = (pts: readonly Vec2[]) => (signedArea(pts) < 0 ? pts.toReversed() : [...pts]);
  const pw = wind(p);
  const qw = wind(q).map((v) => pw.find((u) => near(u, v, tolerance)) ?? v);
  const pAll = withPointsOnEdges(pw, qw, tolerance);
  const qAll = withPointsOnEdges(qw, pw, tolerance).map(
    (v) => pAll.find((u) => near(u, v, tolerance)) ?? v,
  );
  const key = (v: Vec2) => `${v.x.toFixed(6)},${v.y.toFixed(6)}`;
  const edges = (pts: Vec2[]) => pts.map((v, i) => [v, pts[(i + 1) % pts.length]!] as const);
  const all = [...edges(pAll), ...edges(qAll)];
  const ids = new Set(all.map(([u, v]) => `${key(u)}>${key(v)}`));
  const kept = all.filter(([u, v]) => !ids.has(`${key(v)}>${key(u)}`));
  if (kept.length === all.length) return undefined;

  const next = new Map<string, Vec2[]>();
  for (const [u, v] of kept) next.set(key(u), [...(next.get(key(u)) ?? []), v]);
  if ([...next.values()].some((vs) => vs.length > 1)) return undefined;
  const start = kept[0]![0];
  const loop = [start];
  for (let v = next.get(key(start))?.[0]; v && key(v) !== key(start); ) {
    loop.push(v);
    if (loop.length > kept.length) return undefined;
    v = next.get(key(v))?.[0];
  }
  if (loop.length !== kept.length) return undefined;
  return simplify(loop);
}
