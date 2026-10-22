import type { Floorplan, Room, Vec2, Wall } from '@roomie/schema';
import { leftNormal, wallDirection, wallLength } from './walls';

/** Pieces shorter than this don't count as overlapping. */
const EPS = 1e-6;

/** The walls along a room's boundary: lying on one of its edges and overlapping it. */
export function roomWalls(room: Room, walls: readonly Wall[], tolerance = 0.05): Wall[] {
  const edges = room.boundary.map((a, i) => [a, room.boundary[(i + 1) % room.boundary.length]!]);
  return walls.filter((wall) =>
    edges.some(([a, b]) => {
      const edge: Wall = { id: '', a: a!, b: b!, thickness: 0 };
      const length = wallLength(edge);
      if (length < EPS) return false;
      const d = wallDirection(edge);
      const n = leftNormal(d);
      const along = (p: Vec2) => (p.x - a!.x) * d.x + (p.y - a!.y) * d.y;
      const across = (p: Vec2) => Math.abs((p.x - a!.x) * n.x + (p.y - a!.y) * n.y);
      if (across(wall.a) > tolerance || across(wall.b) > tolerance) return false;
      const [t0, t1] = [along(wall.a), along(wall.b)].sort((u, v) => u - v);
      return Math.min(t1!, length) - Math.max(t0!, 0) > tolerance;
    }),
  );
}

export function roomCeiling(plan: Pick<Floorplan, 'ceilingHeight'>, room: Room): number {
  return room.ceilingHeight ?? plan.ceilingHeight;
}

/** A wall is as tall as the tallest ceiling of the rooms it bounds, else the home's ceiling. */
export function wallHeight(plan: Pick<Floorplan, 'ceilingHeight' | 'rooms'>, wall: Wall): number {
  const ceilings = plan.rooms
    .filter((room) => roomWalls(room, [wall]).length > 0)
    .map((room) => roomCeiling(plan, room));
  return ceilings.length > 0 ? Math.max(...ceilings) : plan.ceilingHeight;
}
