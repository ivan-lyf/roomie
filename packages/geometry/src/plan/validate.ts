import type { Floorplan, FloorplanStatus, Vec2 } from '@roomie/schema';
import { area, centroid, contains } from './polygon';
import { closestOnSegment, distance } from './snap';
import { wallHeight } from './rooms';
import { wallLength } from './walls';

/** Measurements can be this far off before they count as a problem. */
const TOLERANCE = 0.01;
/** Smaller than a closet: the outline is almost certainly wrong. */
const MIN_ROOM_AREA = 0.5;
/** Shorter than this, a wall is a slip of the mouse. */
const MIN_WALL = 0.05;
/** Rooms may share edges, and miss each other by a little where they're traced by hand. */
const OVERLAP_TOLERANCE = 0.05;

export type PlanProblem = {
  code:
    | 'no_scale'
    | 'no_rooms'
    | 'room_too_small'
    | 'rooms_overlap'
    | 'wall_too_short'
    | 'unknown_wall'
    | 'opening_off_wall'
    | 'openings_overlap'
    | 'opening_too_tall';
  message: string;
  /** The rooms, walls or openings involved. */
  ids: string[];
};

/**
 * Hard checks a floorplan must pass before it's rendered or furnished. Each problem says what's
 * wrong and which elements are involved; an empty list means the plan is sound.
 */
export function validateFloorplan(plan: Floorplan): PlanProblem[] {
  const problems: PlanProblem[] = [];
  if (!plan.scale) {
    problems.push({
      code: 'no_scale',
      message: 'The plan has no scale yet: calibrate it.',
      ids: [],
    });
  }
  if (plan.rooms.length === 0) {
    problems.push({
      code: 'no_rooms',
      message: 'No rooms yet: outline at least one.',
      ids: [],
    });
  }
  for (const wall of plan.walls) {
    if (wallLength(wall) < Math.max(wall.thickness, MIN_WALL)) {
      problems.push({
        code: 'wall_too_short',
        message: 'A wall is shorter than it is thick: delete it or drag its end.',
        ids: [wall.id],
      });
    }
  }
  plan.rooms.forEach((room, i) => {
    for (const other of plan.rooms.slice(i + 1)) {
      if (overlap(room.boundary, other.boundary)) {
        problems.push({
          code: 'rooms_overlap',
          message: `${room.name} and ${other.name} overlap.`,
          ids: [room.id, other.id],
        });
      }
    }
  });
  for (const room of plan.rooms) {
    if (area(room.boundary) < MIN_ROOM_AREA) {
      problems.push({
        code: 'room_too_small',
        message: `${room.name} is under ${MIN_ROOM_AREA} m²: check its outline.`,
        ids: [room.id],
      });
    }
  }

  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  for (const opening of plan.openings) {
    const wall = walls.get(opening.wallId);
    if (!wall) {
      problems.push({
        code: 'unknown_wall',
        message: `An opening is on a wall that doesn't exist.`,
        ids: [opening.id],
      });
      continue;
    }
    const end = opening.offset + opening.width;
    if (opening.offset < -TOLERANCE || end > wallLength(wall) + TOLERANCE) {
      problems.push({
        code: 'opening_off_wall',
        message: `A ${opening.kind} runs past the end of its wall.`,
        ids: [opening.id, wall.id],
      });
    }
    const top = opening.height + (opening.kind === 'window' ? (opening.sillHeight ?? 0) : 0);
    if (top > wallHeight(plan, wall) + TOLERANCE) {
      problems.push({
        code: 'opening_too_tall',
        message: `A ${opening.kind} is taller than its wall.`,
        ids: [opening.id, wall.id],
      });
    }
  }

  const byWall = new Map<string, typeof plan.openings>();
  for (const o of plan.openings) byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o]);
  for (const [wallId, openings] of byWall) {
    const sorted = openings.toSorted((a, b) => a.offset - b.offset);
    for (let i = 1; i < sorted.length; i++) {
      const [prev, next] = [sorted[i - 1]!, sorted[i]!];
      if (prev.offset + prev.width > next.offset + TOLERANCE) {
        problems.push({
          code: 'openings_overlap',
          message: 'Two openings overlap on the same wall.',
          ids: [prev.id, next.id, wallId],
        });
      }
    }
  }
  return problems;
}

/** How far a point is from a polygon's outline. */
function toOutline(points: readonly Vec2[], p: Vec2): number {
  return Math.min(
    ...points.map((a, i) => {
      const b = points[(i + 1) % points.length]!;
      return distance(p, closestOnSegment(p, { a, b }).point);
    }),
  );
}

/** Whether a point is inside a polygon, and not just on (or near) its outline. */
const deepInside = (points: readonly Vec2[], p: Vec2) =>
  contains(points, p) && toOutline(points, p) > OVERLAP_TOLERANCE;

/** Whether two edges cross each other in the middle, well away from their ends. */
function edgesCross(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const side = (u: Vec2, v: Vec2, w: Vec2) =>
    (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  const [d1, d2] = [side(a, b, p), side(a, b, q)];
  const [d3, d4] = [side(p, q, a), side(p, q, b)];
  if (!(d1 * d2 < 0 && d3 * d4 < 0)) return false;
  // An end on the other edge's line is a touch: edges along one line can lean a hair apart in
  // floating point, which would put a "crossing" anywhere along them.
  const [ab, pq] = [distance(a, b), distance(p, q)];
  if (Math.min(Math.abs(d1), Math.abs(d2)) <= OVERLAP_TOLERANCE * ab) return false;
  if (Math.min(Math.abs(d3), Math.abs(d4)) <= OVERLAP_TOLERANCE * pq) return false;
  // A crossing within the tolerance of an end is two rooms meeting at a corner.
  const ends = [p, q, a, b];
  const t = d1 / (d1 - d2);
  const at = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  return ends.every((e) => distance(e, at) > OVERLAP_TOLERANCE);
}

/** Whether two room outlines overlap by more than sharing an edge. */
function overlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if ([...a, centroid(a)].some((p) => deepInside(b, p))) return true;
  if ([...b, centroid(b)].some((p) => deepInside(a, p))) return true;
  return a.some((p, i) =>
    b.some((u, j) => edgesCross(p, a[(i + 1) % a.length]!, u, b[(j + 1) % b.length]!)),
  );
}

/**
 * Where a plan stands: `needs_calibration` without a scale, `ready` once it has rooms and passes
 * every check, else still being traced (`uploaded`).
 */
export function planStatus(plan: Floorplan): FloorplanStatus {
  if (!plan.scale) return 'needs_calibration';
  return validateFloorplan(plan).length === 0 ? 'ready' : 'uploaded';
}
