import { describe, expect, it } from 'vitest';
import demo from '../../../fixtures/plans/00-demo-1br/floorplan.json';
import studio from '../../../fixtures/plans/01-demo-studio-metric/floorplan.json';
import { FURNISHABLE, Floorplan } from './index';

describe('fixtures/plans', () => {
  it.each([
    ['00-demo-1br', demo],
    ['01-demo-studio-metric', studio],
  ])('%s is a valid floorplan', (_, json) => {
    const plan = Floorplan.parse(json);
    const labels = new Set(plan.labels.map((t) => t.id));
    const walls = new Set(plan.walls.map((w) => w.id));
    for (const room of plan.rooms) {
      expect(room.furnishable).toBe(FURNISHABLE.has(room.roomType));
      for (const id of room.labelTextIds) expect(labels.has(id)).toBe(true);
    }
    for (const opening of plan.openings) expect(walls.has(opening.wallId)).toBe(true);
  });
});
