import type { Opening, Vec2, Wall } from '@roomie/schema';
import { DEFAULT_SILL_HEIGHT } from './heights';

/** Pieces shorter or thinner than this are dropped. */
const EPS = 1e-6;

export function wallLength(wall: Wall): number {
  return Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
}

/** Unit vector from `a` to `b`. */
export function wallDirection(wall: Wall): Vec2 {
  const length = wallLength(wall) || 1;
  return { x: (wall.b.x - wall.a.x) / length, y: (wall.b.y - wall.a.y) / length };
}

/** The normal to the left of a direction, as seen on the plan (y points down the page). */
export function leftNormal(direction: Vec2): Vec2 {
  return { x: direction.y, y: -direction.x };
}

/** The point `distance` meters along the wall from `a`. */
export function pointAlong(wall: Wall, distance: number): Vec2 {
  const d = wallDirection(wall);
  return { x: wall.a.x + d.x * distance, y: wall.a.y + d.y * distance };
}

/**
 * A box of wall: its center in plan space, length along the wall and thickness across it, from
 * `bottom` to `top` above the floor. `from` and `to` are where it starts and ends along the wall,
 * in meters from `a`. `rotationY` turns a box whose length runs along local X onto the wall, in
 * three.js terms (plan (x, y) is 3D (x, 0, y)).
 */
export type WallPiece = {
  center: Vec2;
  from: number;
  to: number;
  length: number;
  thickness: number;
  bottom: number;
  top: number;
  rotationY: number;
};

/**
 * The boxes a wall is built from: solid runs between openings, the wall above each door or
 * passage, and the wall below and above each window. Openings are clamped to the wall, and
 * overlapping ones share a gap. The wall's two ends reach half its thickness further, so walls
 * meeting at a corner close it. Pieces are also cut at `breaks` (meters from `a`), so each one
 * has the same rooms beside it all along (see `wallBreaks`).
 */
export function wallPieces(
  wall: Wall,
  openings: readonly Opening[],
  height: number,
  breaks: readonly number[] = [],
): WallPiece[] {
  const length = wallLength(wall);
  const half = wall.thickness / 2;
  const rotationY = -Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
  type Span = { from: number; to: number; bottom: number; top: number };
  const spans: Span[] = [];
  // The wall ends extend past `a` and `b`; openings never do.
  const solid = (from: number, to: number) =>
    spans.push({
      from: from === 0 ? -half : from,
      to: to === length ? length + half : to,
      bottom: 0,
      top: height,
    });

  const own = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({ ...o, start: Math.max(0, o.offset), end: Math.min(length, o.offset + o.width) }))
    .filter((o) => o.end > o.start)
    .sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const o of own) {
    const start = Math.max(o.start, cursor);
    if (start > cursor) solid(cursor, start);
    if (o.end <= start) continue;
    if (o.kind === 'window') {
      const sill = Math.min(o.sillHeight ?? DEFAULT_SILL_HEIGHT, height);
      const head = Math.min(sill + o.height, height);
      spans.push({ from: start, to: o.end, bottom: 0, top: sill });
      spans.push({ from: start, to: o.end, bottom: head, top: height });
    } else {
      spans.push({ from: start, to: o.end, bottom: Math.min(o.height, height), top: height });
    }
    cursor = o.end;
  }
  if (cursor < length) solid(cursor, length);

  const cuts = breaks.filter((t) => t > EPS && t < length - EPS).toSorted((a, b) => a - b);
  return spans
    .flatMap((s) => {
      const inside = cuts.filter((t) => t > s.from + EPS && t < s.to - EPS);
      const ends = [s.from, ...inside, s.to];
      return ends.slice(1).map((to, i) => ({ ...s, from: ends[i]!, to }));
    })
    .filter((s) => s.to - s.from > EPS && s.top - s.bottom > EPS)
    .map((s) => ({
      center: pointAlong(wall, (s.from + s.to) / 2),
      from: s.from,
      to: s.to,
      length: s.to - s.from,
      thickness: wall.thickness,
      bottom: s.bottom,
      top: s.top,
      rotationY,
    }));
}

/**
 * A door's hinge, the direction of its closed leaf (along the wall, toward the far jamb), and of
 * its open leaf (at 90°, into the side it swings to). The leaf is as long as the opening is wide.
 */
export function doorSwing(
  wall: Wall,
  opening: Opening,
): { hinge: Vec2; closed: Vec2; open: Vec2; radius: number } | undefined {
  if (opening.kind !== 'door' || !opening.swing) return undefined;
  const d = wallDirection(wall);
  const atStart = opening.swing.hinge === 'start';
  const hinge = pointAlong(wall, atStart ? opening.offset : opening.offset + opening.width);
  const closed = atStart ? d : { x: -d.x, y: -d.y };
  const left = leftNormal(d);
  const open = opening.swing.side === 'left' ? left : { x: -left.x, y: -left.y };
  return { hinge, closed, open, radius: opening.width };
}
