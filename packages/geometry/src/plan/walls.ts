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
 * `bottom` to `top` above the floor. `rotationY` turns a box whose length runs along local X
 * onto the wall, in three.js terms (plan (x, y) is 3D (x, 0, y)).
 */
export type WallPiece = {
  center: Vec2;
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
 * meeting at a corner close it.
 */
export function wallPieces(wall: Wall, openings: readonly Opening[], height: number): WallPiece[] {
  const length = wallLength(wall);
  const half = wall.thickness / 2;
  const rotationY = -Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
  const piece = (from: number, to: number, bottom: number, top: number): WallPiece => ({
    center: pointAlong(wall, (from + to) / 2),
    length: to - from,
    thickness: wall.thickness,
    bottom,
    top,
    rotationY,
  });
  // The wall ends extend past `a` and `b`; openings never do.
  const solid = (from: number, to: number) =>
    piece(from === 0 ? -half : from, to === length ? length + half : to, 0, height);

  const own = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({ ...o, start: Math.max(0, o.offset), end: Math.min(length, o.offset + o.width) }))
    .filter((o) => o.end > o.start)
    .sort((a, b) => a.start - b.start);

  const pieces: WallPiece[] = [];
  let cursor = 0;
  for (const o of own) {
    const start = Math.max(o.start, cursor);
    if (start > cursor) pieces.push(solid(cursor, start));
    if (o.end <= start) continue;
    if (o.kind === 'window') {
      const sill = Math.min(o.sillHeight ?? DEFAULT_SILL_HEIGHT, height);
      const head = Math.min(sill + o.height, height);
      pieces.push(piece(start, o.end, 0, sill), piece(start, o.end, head, height));
    } else {
      pieces.push(piece(start, o.end, Math.min(o.height, height), height));
    }
    cursor = o.end;
  }
  if (cursor < length) pieces.push(solid(cursor, length));
  return pieces.filter((p) => p.length > EPS && p.top - p.bottom > EPS);
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
