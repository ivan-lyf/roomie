import type { Floorplan } from '@roomie/schema';
import { area } from './polygon';
import { wallHeight } from './rooms';
import { wallLength } from './walls';

/** Measurements can be this far off before they count as a problem. */
const TOLERANCE = 0.01;
/** Smaller than a closet: the outline is almost certainly wrong. */
const MIN_ROOM_AREA = 0.5;

export type PlanProblem = {
  code:
    | 'no_scale'
    | 'room_too_small'
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
