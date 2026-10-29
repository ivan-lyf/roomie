import type {
  Floorplan,
  Materials,
  Obstacle,
  PlanText,
  Room,
  RoomType,
  Vec2,
  Wall,
} from '@roomie/schema';
import { roomTypeFromLabel } from './labels';
import { OBSTACLE_HEIGHTS } from './heights';
import { area, centroid, contains, signedArea } from './polygon';
import { leftNormal, pointAlong, wallDirection, wallLength } from './walls';

/** Pieces shorter than this don't count as overlapping. */
const EPS = 1e-6;
/** How far past a wall's face to look for the room beside it. */
const BESIDE = 0.05;

/** The room a point is in, if any. */
export function roomAt<R extends Pick<Room, 'boundary'>>(
  rooms: readonly R[],
  p: Vec2,
): R | undefined {
  return rooms.find((room) => contains(room.boundary, p));
}

/**
 * Where along a wall the rooms beside it change, in meters from `a`: the room corners lying on
 * it, short of its ends. Splitting the wall there gives pieces with one room on each side.
 */
export function wallBreaks(wall: Wall, rooms: readonly Room[], tolerance = 0.05): number[] {
  const length = wallLength(wall);
  const d = wallDirection(wall);
  const n = leftNormal(d);
  const breaks: number[] = [];
  for (const p of rooms.flatMap((room) => room.boundary)) {
    const along = (p.x - wall.a.x) * d.x + (p.y - wall.a.y) * d.y;
    const across = Math.abs((p.x - wall.a.x) * n.x + (p.y - wall.a.y) * n.y);
    if (across > tolerance || along < tolerance || along > length - tolerance) continue;
    if (breaks.every((t) => Math.abs(t - along) > tolerance)) breaks.push(along);
  }
  return breaks.sort((a, b) => a - b);
}

/**
 * The rooms on each side of a wall, `at` meters along it: on its left and right walking from `a`
 * to `b` on the plan. Missing on the outside of the home.
 */
export function roomsBeside<R extends Pick<Room, 'boundary'>>(
  wall: Wall,
  at: number,
  rooms: readonly R[],
): { left?: R; right?: R } {
  const p = pointAlong(wall, at);
  const n = leftNormal(wallDirection(wall));
  const away = wall.thickness / 2 + BESIDE;
  const left = roomAt(rooms, { x: p.x + n.x * away, y: p.y + n.y * away });
  const right = roomAt(rooms, { x: p.x - n.x * away, y: p.y - n.y * away });
  return { ...(left && { left }), ...(right && { right }) };
}

/** A room's materials: its own where it has them, else the home's. */
export function roomMaterials(plan: Pick<Floorplan, 'materials'>, room: Room): Materials {
  const own = room.materials;
  return {
    wallColor: own?.wallColor ?? plan.materials.wallColor,
    floor: own?.floor ?? plan.materials.floor,
    light: own?.light ?? plan.materials.light,
  };
}

/** An obstacle's height: as drawn, else the default for its kind, under its room's ceiling. */
export function obstacleHeight(
  plan: Pick<Floorplan, 'ceilingHeight' | 'rooms'>,
  obstacle: Obstacle,
): number {
  const room = roomAt(plan.rooms, centroid(obstacle.polygon));
  const ceiling = room ? roomCeiling(plan, room) : plan.ceilingHeight;
  if (obstacle.height !== undefined) return Math.min(obstacle.height, ceiling);
  const height = OBSTACLE_HEIGHTS[obstacle.kind];
  return height === 'ceiling' ? ceiling : Math.min(height, ceiling);
}

/** The walls along a room's boundary: lying on one of its edges and overlapping it. */
export function roomWalls(
  room: Pick<Room, 'boundary'>,
  walls: readonly Wall[],
  tolerance = 0.05,
): Wall[] {
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

/**
 * How far into a room each edge's walls reach: half their thickness, averaged along the edge
 * (an edge with a wall along half of it reaches in half as far); 0 on a side open to the next
 * room. `walls` only need `a`, `b` and `thickness`, in the outline's units.
 */
export function edgeInsets(
  boundary: readonly Vec2[],
  walls: readonly Pick<Wall, 'a' | 'b' | 'thickness'>[],
  tolerance = 0.05,
): number[] {
  const n = boundary.length;
  return boundary.map((a, i) => {
    const b = boundary[(i + 1) % n]!;
    const edge: Wall = { id: '', a, b, thickness: 0 };
    const length = wallLength(edge);
    if (length < EPS) return 0;
    const d = wallDirection(edge);
    const normal = leftNormal(d);
    const along = (p: Vec2) => (p.x - a.x) * d.x + (p.y - a.y) * d.y;
    const across = (p: Vec2) => Math.abs((p.x - a.x) * normal.x + (p.y - a.y) * normal.y);
    let covered = 0;
    for (const wall of walls) {
      if (across(wall.a) > tolerance || across(wall.b) > tolerance) continue;
      const [t0, t1] = [along(wall.a), along(wall.b)].sort((u, v) => u - v);
      const overlap = Math.min(t1!, length) - Math.max(t0!, 0);
      if (overlap > 0) covered += (overlap * wall.thickness) / 2;
    }
    return Math.min(covered / length, length / 2);
  });
}

/**
 * A room's floor area inside its walls: its outline (on the walls' center lines) less half of
 * each wall along each edge, with the corners where two walls meet put right. An edge with no
 * wall along it (a room open to the next) loses nothing. `walls` only need `a`, `b` and
 * `thickness`, in the outline's units.
 */
export function floorArea(
  boundary: readonly Vec2[],
  walls: readonly Pick<Wall, 'a' | 'b' | 'thickness'>[],
  tolerance = 0.05,
): number {
  const n = boundary.length;
  const inset = edgeInsets(boundary, walls, tolerance);
  const lengths = boundary.map((a, i) => {
    const b = boundary[(i + 1) % n]!;
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
  const sign = Math.sign(signedArea(boundary)) || 1;
  let lost = 0;
  for (let i = 0; i < n; i++) {
    lost += lengths[i]! * inset[i]!;
    // Where two insets meet, a convex corner was taken off twice, a reflex one not at all.
    const [prev, here, next] = [boundary[(i + n - 1) % n]!, boundary[i]!, boundary[(i + 1) % n]!];
    const turn = (here.x - prev.x) * (next.y - here.y) - (here.y - prev.y) * (next.x - here.x);
    lost -= Math.sign(turn) * sign * inset[(i + n - 1) % n]! * inset[i]!;
  }
  return Math.max(area(boundary) - lost, 0);
}

/**
 * A room's floor: its outline moved in by half of each wall along each edge, the outline
 * `floorArea` measures. An edge with no wall along it stays where it is, open to the next room.
 */
export function floorPolygon(
  boundary: readonly Vec2[],
  walls: readonly Pick<Wall, 'a' | 'b' | 'thickness'>[],
  tolerance = 0.05,
): Vec2[] {
  const n = boundary.length;
  const inset = edgeInsets(boundary, walls, tolerance);
  // With y down the page, a positive signed area runs clockwise: the inside is on the right.
  const inward = -(Math.sign(signedArea(boundary)) || 1);
  const lines = boundary.map((a, i) => {
    const d = wallDirection({ id: '', a, b: boundary[(i + 1) % n]!, thickness: 0 });
    const normal = leftNormal(d);
    const by = inward * inset[i]!;
    return { p: { x: a.x + normal.x * by, y: a.y + normal.y * by }, d };
  });
  return lines.map((here, i) => {
    const prev = lines[(i + n - 1) % n]!;
    const cross = prev.d.x * here.d.y - prev.d.y * here.d.x;
    // Edges in a straight line: the corner moves in with this edge.
    if (Math.abs(cross) < 1e-9) return here.p;
    const t = ((here.p.x - prev.p.x) * here.d.y - (here.p.y - prev.p.y) * here.d.x) / cross;
    return { x: prev.p.x + prev.d.x * t, y: prev.p.y + prev.d.y * t };
  });
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

/** The plan's text inside an outline: labels are boxes in image pixels, placed by their center. */
export function labelsIn(
  plan: Pick<Floorplan, 'labels' | 'scale'>,
  boundary: readonly Vec2[],
): PlanText[] {
  const mpp = plan.scale?.metersPerPixel;
  if (!mpp) return [];
  return plan.labels.filter((label) =>
    contains(boundary, {
      x: (label.bbox.x + label.bbox.w / 2) * mpp,
      y: (label.bbox.y + label.bbox.h / 2) * mpp,
    }),
  );
}

/** The room type the first room label in a list names. */
export function roomTypeFromLabels(labels: readonly PlanText[]): RoomType | undefined {
  for (const label of labels) {
    const type = label.parsed?.roomType ?? roomTypeFromLabel(label.text);
    if (type) return type;
  }
  return undefined;
}
