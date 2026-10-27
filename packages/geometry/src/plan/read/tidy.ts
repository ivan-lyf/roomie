import type { DoorSwing, PlanDraft, RawPlan, Vec2 } from '@roomie/schema';
import { area, simplify } from '../polygon';
import { median } from '../scale';
import { distance } from '../snap';
import { separateRooms } from './separate';

// Tidies what a plan reader returned, in image pixels: a vision model's walls are roughly placed,
// broken at openings and short of their corners. Tolerances follow the image size and the walls'
// typical thickness, since there's no scale yet.

export type ImageSize = { width: number; height: number };

const DEGREE = Math.PI / 180;
/** Walls within this of level or plumb are made exactly so. */
const STRAIGHTEN = 3 * DEGREE;
/** Walls this close to parallel can be one wall. */
const PARALLEL = 2 * DEGREE;
/** An opening this close to parallel to a wall can sit in it. */
const OPENING_ANGLE = 15 * DEGREE;
/** Walls at least this far from parallel make a corner. */
const CORNER = 20 * DEGREE;

type Segment = { a: Vec2; b: Vec2; thickness: number };

const sub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, y: p.y - q.y });
const direction = (s: { a: Vec2; b: Vec2 }): Vec2 => {
  const d = sub(s.b, s.a);
  const length = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / length, y: d.y / length };
};
/** How far `p` is along a line through `a` in direction `d`. */
const along = (p: Vec2, a: Vec2, d: Vec2) => (p.x - a.x) * d.x + (p.y - a.y) * d.y;
/** How far `p` is off that line, signed. */
const across = (p: Vec2, a: Vec2, d: Vec2) => (p.x - a.x) * d.y - (p.y - a.y) * d.x;
/** The point `t` along and `o` across a line. */
const at = (a: Vec2, d: Vec2, t: number, o = 0): Vec2 => ({
  x: a.x + d.x * t + d.y * o,
  y: a.y + d.y * t - d.x * o,
});
/** The angle between two lines, whichever way they point: 0 to 90°. */
const angleBetween = (d: Vec2, e: Vec2) => Math.acos(Math.min(1, Math.abs(d.x * e.x + d.y * e.y)));

/** Where two lines cross, if they aren't parallel. */
function intersect(a: Vec2, d: Vec2, b: Vec2, e: Vec2): Vec2 | undefined {
  const denom = d.x * e.y - d.y * e.x;
  if (Math.abs(denom) < 1e-9) return undefined;
  const t = ((b.x - a.x) * e.y - (b.y - a.y) * e.x) / denom;
  return at(a, d, t);
}

/**
 * How near counts as the same place on this image: 0.6% of its long side, or most of a wall's
 * thickness if that's more.
 */
export function draftTolerance(size: ImageSize, wallThickness: number): number {
  return Math.max(0.006 * Math.max(size.width, size.height), 0.75 * wallThickness, 2);
}

/** Makes a wall exactly level or plumb when it's nearly so. */
function straighten(w: Segment): Segment {
  const d = direction(w);
  if (Math.abs(d.y) < Math.sin(STRAIGHTEN)) {
    const y = (w.a.y + w.b.y) / 2;
    return { ...w, a: { x: w.a.x, y }, b: { x: w.b.x, y } };
  }
  if (Math.abs(d.x) < Math.sin(STRAIGHTEN)) {
    const x = (w.a.x + w.b.x) / 2;
    return { ...w, a: { x, y: w.a.y }, b: { x, y: w.b.y } };
  }
  return w;
}

/**
 * Joins pieces of one wall: parallel, on the same line (or its two faces read as two walls), and
 * overlapping, touching, or apart only where an opening is.
 */
function mergeCollinear(walls: Segment[], openings: readonly Segment[], tol: number): Segment[] {
  const out = [...walls];
  for (let merged = true; merged; ) {
    merged = false;
    search: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const joined = mergePair(out[i]!, out[j]!, openings, tol);
        if (!joined) continue;
        out[i] = joined;
        out.splice(j, 1);
        merged = true;
        break search;
      }
    }
  }
  return out;
}

function mergePair(p: Segment, q: Segment, openings: readonly Segment[], tol: number) {
  const d = direction(p);
  if (angleBetween(d, direction(q)) > PARALLEL) return undefined;
  const offsets = [across(q.a, p.a, d), across(q.b, p.a, d)];
  const reach = Math.max(tol / 2, Math.max(p.thickness, q.thickness) * 0.6);
  if (offsets.some((o) => Math.abs(o) > reach)) return undefined;
  const pEnd = distance(p.a, p.b);
  const [q0, q1] = [along(q.a, p.a, d), along(q.b, p.a, d)].sort((u, v) => u - v) as [
    number,
    number,
  ];
  const gap = Math.max(q0 - pEnd, -q1);
  if (gap > tol) {
    // A wider gap is still one wall when an opening fills it.
    const [from, to] = q0 > pEnd ? [pEnd, q0] : [q1, 0];
    const filled = openings.some((o) => {
      const near = [o.a, o.b].every((e) => Math.abs(across(e, p.a, d)) <= reach + tol);
      const [o0, o1] = [along(o.a, p.a, d), along(o.b, p.a, d)].sort((u, v) => u - v);
      return near && o0! <= from + tol && o1! >= to - tol;
    });
    if (!filled) return undefined;
  }
  const pLength = pEnd;
  const qLength = q1 - q0;
  const offset = ((offsets[0]! + offsets[1]!) / 2) * (qLength / (pLength + qLength));
  return {
    a: at(p.a, d, Math.min(0, q0), offset),
    b: at(p.a, d, Math.max(pEnd, q1), offset),
    thickness: (p.thickness * pLength + q.thickness * qLength) / (pLength + qLength),
  };
}

/**
 * Wall ends near each other meet at one point: where their center lines cross (a corner), or
 * between them when they run on.
 */
function joinCorners(walls: Segment[], tol: number): Segment[] {
  const ends = walls.flatMap((w, i) => [
    { wall: i, end: 'a' as const, p: w.a },
    { wall: i, end: 'b' as const, p: w.b },
  ]);
  const parent = ends.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      if (ends[i]!.wall !== ends[j]!.wall && distance(ends[i]!.p, ends[j]!.p) <= tol) {
        parent[find(i)] = find(j);
      }
    }
  }
  const clusters = new Map<number, typeof ends>();
  ends.forEach((e, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), e]));

  const out = walls.map((w) => ({ ...w }));
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue;
    const centroid = {
      x: cluster.reduce((s, e) => s + e.p.x, 0) / cluster.length,
      y: cluster.reduce((s, e) => s + e.p.y, 0) / cluster.length,
    };
    // The point nearest every wall's line, by least squares; ends of walls running on (all
    // parallel) meet in the middle instead.
    let [m00, m01, m11, r0, r1] = [0, 0, 0, 0, 0];
    for (const e of cluster) {
      const w = walls[e.wall]!;
      const d = direction(w);
      const [a00, a01, a11] = [1 - d.x * d.x, -d.x * d.y, 1 - d.y * d.y];
      m00 += a00;
      m01 += a01;
      m11 += a11;
      r0 += a00 * w.a.x + a01 * w.a.y;
      r1 += a01 * w.a.x + a11 * w.a.y;
    }
    const det = m00 * m11 - m01 * m01;
    let corner = centroid;
    if (det > 1e-3 * cluster.length * cluster.length) {
      const solved = { x: (r0 * m11 - r1 * m01) / det, y: (m00 * r1 - m01 * r0) / det };
      if (distance(solved, centroid) <= 2 * tol) corner = solved;
    }
    for (const e of cluster) out[e.wall]![e.end] = { ...corner };
  }
  return out;
}

/**
 * A wall end that meets no other wall end is run on or cut back, along its own line, to the
 * nearest wall it nearly reaches: a T-junction, or a wall stopping short of a corner.
 */
function meetWalls(walls: Segment[], tol: number): Segment[] {
  const out = walls.map((w) => ({ ...w }));
  const shared = (p: Vec2, self: number) =>
    out.some((w, i) => i !== self && (distance(w.a, p) < 0.5 || distance(w.b, p) < 0.5));
  out.forEach((w, i) => {
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      if (shared(p, i)) continue;
      const d = direction(w);
      let best: Vec2 | undefined;
      out.forEach((other, j) => {
        if (j === i) return;
        const e = direction(other);
        if (angleBetween(d, e) < CORNER) return;
        const x = intersect(p, d, other.a, e);
        if (!x || distance(p, x) > tol) return;
        const t = along(x, other.a, e);
        if (t < -tol || t > distance(other.a, other.b) + tol) return;
        if (!best || distance(p, x) < distance(p, best)) best = x;
      });
      if (best) w[end] = best;
    }
  });
  return out;
}

/**
 * Places each opening on the nearest wall running its way, as a distance from the wall's start
 * and a width, and works out a door's hinge and swing side from where its leaf was drawn.
 * Openings overlapping another on the same wall are trimmed, or dropped if mostly covered.
 */
function placeOpenings(raw: RawPlan['openings'], walls: PlanDraft['walls'], tol: number) {
  const placed: PlanDraft['openings'] = [];
  for (const o of raw) {
    const od = direction(o);
    const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
    let best: { wall: PlanDraft['walls'][number]; off: number } | undefined;
    for (const wall of walls) {
      const d = direction(wall);
      if (angleBetween(d, od) > OPENING_ANGLE) continue;
      const off = Math.abs(across(mid, wall.a, d));
      const t = along(mid, wall.a, d);
      if (off > wall.thickness / 2 + tol || t < -tol || t > distance(wall.a, wall.b) + tol)
        continue;
      if (!best || off < best.off) best = { wall, off };
    }
    if (!best) continue;
    const { wall } = best;
    const d = direction(wall);
    const length = distance(wall.a, wall.b);
    const clamp = (t: number) => Math.min(Math.max(t, 0), length);
    const [from, to] = [clamp(along(o.a, wall.a, d)), clamp(along(o.b, wall.a, d))].sort(
      (u, v) => u - v,
    ) as [number, number];
    if (to - from < tol) continue;
    let swing: DoorSwing | undefined;
    if (o.kind === 'door') {
      swing = { hinge: 'start', side: 'left' };
      if (o.swing) {
        const h = along(o.swing.hinge, wall.a, d);
        // Left of the wall, walking from a to b on the plan (see `leftNormal`), is where
        // `across` is positive.
        const side = across(o.swing.toward, wall.a, d) > 0 ? 'left' : 'right';
        swing = { hinge: Math.abs(h - from) <= Math.abs(h - to) ? 'start' : 'end', side };
      }
    }
    placed.push({
      id: '',
      wallId: wall.id,
      kind: o.kind,
      offset: from,
      width: to - from,
      ...(swing && { swing }),
    });
  }

  const kept: PlanDraft['openings'] = [];
  for (const o of placed.toSorted(
    (p, q) => p.wallId.localeCompare(q.wallId) || p.offset - q.offset,
  )) {
    const prev = kept.at(-1);
    if (prev && prev.wallId === o.wallId && o.offset < prev.offset + prev.width) {
      const overlap = prev.offset + prev.width - o.offset;
      if (overlap > Math.min(prev.width, o.width) / 2 || o.width - overlap < tol) continue;
      kept.push({ ...o, offset: o.offset + overlap, width: o.width - overlap });
      continue;
    }
    kept.push(o);
  }
  return kept.map((o, i) => ({ ...o, id: `o${i + 1}` }));
}

/**
 * Moves an outline's corner onto the walls' center lines: to the corner of the two walls it's
 * near, else onto the one wall's line. A reader often follows the inside face of the walls.
 */
function snapToWalls(p: Vec2, walls: PlanDraft['walls'], tol: number): Vec2 {
  const near = walls
    .map((w) => {
      const d = direction(w);
      const off = Math.abs(across(p, w.a, d));
      const t = along(p, w.a, d);
      const reach = w.thickness / 2 + tol;
      const within = t >= -reach && t <= distance(w.a, w.b) + reach;
      return { w, d, off, ok: off <= reach && within };
    })
    .filter((n) => n.ok)
    .sort((m, n) => m.off - n.off);
  if (near.length === 0) return p;
  let corner: Vec2 | undefined;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const [m, n] = [near[i]!, near[j]!];
      if (angleBetween(m.d, n.d) < CORNER) continue;
      const x = intersect(m.w.a, m.d, n.w.a, n.d);
      const reach = Math.max(m.w.thickness, n.w.thickness) + tol;
      if (x && distance(x, p) <= reach && (!corner || distance(x, p) < distance(corner, p))) {
        corner = x;
      }
    }
  }
  if (corner) return corner;
  const { w, d } = near[0]!;
  return at(w.a, d, along(p, w.a, d));
}

/** A polygon tidied: corners onto walls, repeated and in-line points dropped. */
function tidyPolygon(points: readonly Vec2[], walls: PlanDraft['walls'], tol: number) {
  return simplify(
    points.map((p) => snapToWalls(p, walls, tol)),
    1.5,
  );
}

/** A nearly square-cornered four-sided outline becomes its exact bounding box. */
function squareUp(points: Vec2[]): Vec2[] {
  if (points.length !== 4) return points;
  const level = points.every((p, i) => {
    const d = direction({ a: p, b: points[(i + 1) % 4]! });
    return Math.abs(d.x) < Math.sin(STRAIGHTEN) || Math.abs(d.y) < Math.sin(STRAIGHTEN);
  });
  if (!level) return points;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * Tidies a reader's plan into a draft: walls straightened, joined and met at corners and
 * T-junctions; openings placed on their walls; rooms and fixtures on the walls' center lines,
 * and overlapping rooms cut apart; text kept as read. Everything stays in image pixels.
 */
export function tidyDraft(raw: RawPlan, size: ImageSize): PlanDraft {
  const inside = (p: Vec2): Vec2 => ({
    x: Math.min(Math.max(p.x, 0), size.width),
    y: Math.min(Math.max(p.y, 0), size.height),
  });
  const given = raw.walls
    .map((w) => ({ a: inside(w.a), b: inside(w.b), thickness: w.thickness }))
    .filter((w) => distance(w.a, w.b) > 1);
  const thicknesses = given.map((w) => w.thickness).filter((t) => t > 0);
  const typical =
    thicknesses.length > 0 ? median(thicknesses) : 0.008 * Math.max(size.width, size.height);
  const tol = draftTolerance(size, typical);
  const openingSegments = raw.openings.map((o) => ({
    a: inside(o.a),
    b: inside(o.b),
    thickness: 0,
  }));

  let segments = given.map((w) =>
    straighten({
      ...w,
      thickness:
        w.thickness > 0 ? Math.min(Math.max(w.thickness, typical / 3), typical * 3) : typical,
    }),
  );
  segments = mergeCollinear(segments, openingSegments, tol);
  segments = joinCorners(segments, tol);
  segments = meetWalls(segments, tol);
  const walls = segments
    .filter((w) => distance(w.a, w.b) >= w.thickness)
    .map((w, i) => ({ id: `w${i + 1}`, ...w }));

  const openings = placeOpenings(
    raw.openings.map((o) => ({ ...o, a: inside(o.a), b: inside(o.b) })),
    walls,
    tol,
  );

  const minArea = (2 * tol) ** 2;
  const traced = raw.rooms
    .map((r) => ({ ...r, polygon: tidyPolygon(r.polygon.map(inside), walls, tol) }))
    .filter((r) => r.polygon.length >= 3 && area(r.polygon) >= minArea);
  const rooms = separateRooms(traced, raw.texts, minArea)
    .map((r, i) => ({
      id: `r${i + 1}`,
      polygon: r.polygon,
      ...(r.label?.trim() ? { label: r.label.trim() } : {}),
      ...(r.type && { type: r.type }),
    }));

  const obstacles = raw.obstacles
    .map((o) => ({ kind: o.kind, polygon: squareUp(simplify(o.polygon.map(inside), 1.5)) }))
    .filter((o) => o.polygon.length >= 3 && area(o.polygon) >= tol * tol)
    .map((o, i) => ({ id: `k${i + 1}`, ...o }));

  const texts = raw.texts
    .map((t) => ({ text: t.text.trim(), bbox: t.bbox }))
    .filter((t) => t.text !== '')
    .map((t, i) => ({ id: `t${i + 1}`, ...t }));

  return { walls, openings, rooms, obstacles, texts };
}
