import type { Floorplan, Opening, Vec2, Wall } from '@roomie/schema';
import { closestOnSegment, distance } from './snap';
import { wallLength } from './walls';

// Pure edits for the plan editor. Each takes a plan and returns a new one; ids for new elements
// come from the caller, so the same edit always gives the same plan.

export type PlanShapes = Pick<Floorplan, 'walls' | 'openings' | 'rooms' | 'obstacles'>;

/** Points this close are the same point: a wall end on a room corner, two walls meeting. */
export const SAME_POINT = 0.01;

/** Whether anything is traced yet: walls or rooms. A reading replaces what's traced. */
export function isTraced(plan: Pick<Floorplan, 'walls' | 'rooms'>): boolean {
  return plan.walls.length > 0 || plan.rooms.length > 0;
}

/** The first `prefix` + number not taken, e.g. `w10` after `w1`…`w9`. */
export function nextId(taken: Iterable<string>, prefix: string): string {
  let max = 0;
  for (const id of taken) {
    const n = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/** Keeps every opening on its wall: no wider than the wall, and not past either end. */
export function clampOpenings<P extends PlanShapes>(plan: P): P {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  return {
    ...plan,
    openings: plan.openings.map((o) => {
      const wall = walls.get(o.wallId);
      return wall ? clampOpening(o, wallLength(wall)) : o;
    }),
  };
}

function clampOpening(o: Opening, length: number): Opening {
  const width = Math.min(o.width, length);
  const offset = Math.min(Math.max(o.offset, 0), length - width);
  return width === o.width && offset === o.offset ? o : { ...o, width, offset };
}

/** Moves every point within `tolerance` of the ones `move` changes, via `move`. */
function movePoints<P extends PlanShapes>(plan: P, move: (p: Vec2) => Vec2 | undefined): P {
  const at = (p: Vec2) => move(p) ?? p;
  return clampOpenings({
    ...plan,
    walls: plan.walls.map((w) => ({ ...w, a: at(w.a), b: at(w.b) })),
    rooms: plan.rooms.map((r) => ({ ...r, boundary: r.boundary.map(at) })),
    obstacles: plan.obstacles.map((o) => ({ ...o, polygon: o.polygon.map(at) })),
  });
}

/**
 * Drags a point: every wall end, room corner and obstacle corner on it moves with it, so rooms
 * follow their walls. Openings keep their distance from their wall's start.
 */
export function movePoint<P extends PlanShapes>(
  plan: P,
  from: Vec2,
  to: Vec2,
  tolerance = SAME_POINT,
): P {
  return movePoints(plan, (p) => (distance(p, from) <= tolerance ? { ...to } : undefined));
}

/**
 * Drags a whole wall by `delta`: its ends, and every point lying on it (room corners, the ends of
 * walls meeting it), move with it. Walls joined to it stretch to follow.
 */
export function moveWall<P extends PlanShapes>(
  plan: P,
  wallId: string,
  delta: Vec2,
  tolerance = SAME_POINT,
): P {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return plan;
  return movePoints(plan, (p) =>
    distance(closestOnSegment(p, wall).point, p) <= tolerance
      ? { x: p.x + delta.x, y: p.y + delta.y }
      : undefined,
  );
}

/** Adds a wall. */
export function addWall<P extends PlanShapes>(plan: P, wall: Wall): P {
  return { ...plan, walls: [...plan.walls, wall] };
}

/** Removes a wall and the doors and windows in it. */
export function deleteWall<P extends PlanShapes>(plan: P, wallId: string): P {
  return {
    ...plan,
    walls: plan.walls.filter((w) => w.id !== wallId),
    openings: plan.openings.filter((o) => o.wallId !== wallId),
  };
}

/**
 * Splits a wall `at` meters from its start into two, the second with id `newId`. Each opening
 * goes to the half holding its middle, at its distance from that half's start.
 */
export function splitWall<P extends PlanShapes>(
  plan: P,
  wallId: string,
  at: number,
  newId: string,
): P {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return plan;
  const length = wallLength(wall);
  if (at <= SAME_POINT || at >= length - SAME_POINT) return plan;
  const t = at / length;
  const mid = { x: wall.a.x + (wall.b.x - wall.a.x) * t, y: wall.a.y + (wall.b.y - wall.a.y) * t };
  const first: Wall = { ...wall, b: mid };
  const second: Wall = { ...wall, id: newId, a: { ...mid } };
  return clampOpenings({
    ...plan,
    walls: plan.walls.flatMap((w) => (w.id === wallId ? [first, second] : [w])),
    openings: plan.openings.map((o) =>
      o.wallId === wallId && o.offset + o.width / 2 > at
        ? { ...o, wallId: newId, offset: o.offset - at }
        : o,
    ),
  });
}

/** The wall nearest a point within `maxDistance`, and how far along it the point is. */
export function nearestWall(
  walls: readonly Wall[],
  p: Vec2,
  maxDistance: number,
): { wall: Wall; along: number; distance: number } | undefined {
  let best: { wall: Wall; along: number; distance: number } | undefined;
  for (const wall of walls) {
    const { point, t } = closestOnSegment(p, wall);
    const d = distance(p, point);
    if (d <= maxDistance && (!best || d < best.distance)) {
      best = { wall, along: t * wallLength(wall), distance: d };
    }
  }
  return best;
}

/** The offset that centers an opening of `width` at `along`, kept inside the wall. */
export function centeredOffset(wall: Wall, along: number, width: number): number {
  const length = wallLength(wall);
  return Math.min(Math.max(along - width / 2, 0), Math.max(length - width, 0));
}

/**
 * Scales every position and length on the plan by `factor`, for a new scale: plan space is the
 * image's pixels times meters per pixel, so a new scale stretches it all. Heights stay.
 */
export function rescalePlan<P extends PlanShapes>(plan: P, factor: number): P {
  const at = (p: Vec2) => ({ x: p.x * factor, y: p.y * factor });
  return {
    ...plan,
    walls: plan.walls.map((w) => ({
      ...w,
      a: at(w.a),
      b: at(w.b),
      thickness: w.thickness * factor,
    })),
    openings: plan.openings.map((o) => ({
      ...o,
      offset: o.offset * factor,
      width: o.width * factor,
    })),
    rooms: plan.rooms.map((r) => ({ ...r, boundary: r.boundary.map(at) })),
    obstacles: plan.obstacles.map((o) => ({ ...o, polygon: o.polygon.map(at) })),
  };
}
