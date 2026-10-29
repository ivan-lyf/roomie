import { Floorplan } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import {
  centeredOffset,
  deleteWall,
  isTraced,
  movePoint,
  moveWall,
  nearestWall,
  nextId,
  rescalePlan,
  splitWall,
} from './edit';
import { validateFloorplan } from './validate';

const plan = Floorplan.parse(demo);
const wall = (p: Floorplan, id: string) => p.walls.find((w) => w.id === id)!;
const room = (p: Floorplan, id: string) => p.rooms.find((r) => r.id === id)!;
const opening = (p: Floorplan, id: string) => p.openings.find((o) => o.id === id)!;

describe('isTraced', () => {
  it('is traced once it has walls or rooms', () => {
    expect(isTraced(plan)).toBe(true);
    expect(isTraced({ walls: [], rooms: plan.rooms })).toBe(true);
    expect(isTraced({ walls: [], rooms: [] })).toBe(false);
  });
});

describe('nextId', () => {
  it('takes the next free number', () => {
    expect(nextId(['w1', 'w9', 'r3', 'wall'], 'w')).toBe('w10');
    expect(nextId([], 'r')).toBe('r1');
  });
});

describe('movePoint', () => {
  it('moves every wall end and room corner on the point', () => {
    // The north-east corner: w1 ends and w2 starts there; it's a corner of the living room.
    const moved = movePoint(plan, { x: 8.5, y: 0.5 }, { x: 9, y: 0.5 });
    expect(wall(moved, 'w1').b).toEqual({ x: 9, y: 0.5 });
    expect(wall(moved, 'w2').a).toEqual({ x: 9, y: 0.5 });
    expect(room(moved, 'r2').boundary[1]).toEqual({ x: 9, y: 0.5 });
    expect(wall(moved, 'w3')).toEqual(wall(plan, 'w3'));
  });

  it('keeps openings on a wall that gets shorter', () => {
    // w1's windows run to 7 m; pulling its end in to 6 m clamps the second one.
    const moved = movePoint(plan, { x: 8.5, y: 0.5 }, { x: 6.5, y: 0.5 });
    expect(opening(moved, 'o7')).toMatchObject({ offset: 3.5, width: 2.5 });
  });
});

describe('moveWall', () => {
  it('drags a wall with the corners and wall ends on it', () => {
    // The bedroom/living wall moves 0.5 m east; the living room and its closet edge follow.
    const moved = moveWall(plan, 'w5', { x: 0.5, y: 0 });
    expect(wall(moved, 'w5')).toMatchObject({ a: { x: 4.5, y: 0.5 }, b: { x: 4.5, y: 4 } });
    expect(wall(moved, 'w6').b).toEqual({ x: 4.5, y: 4 });
    expect(wall(moved, 'w9').a).toEqual({ x: 4.5, y: 4 });
    expect(room(moved, 'r1').boundary[1]).toEqual({ x: 4.5, y: 0.5 });
    // The living room's corner further down w9 (y 4.6) isn't on w5, so it stays.
    expect(room(moved, 'r2').boundary[3]).toEqual({ x: 4, y: 4.6 });
  });
});

describe('splitWall and deleteWall', () => {
  it('splits a wall, moving the openings past the split to the new half', () => {
    const split = splitWall(plan, 'w1', 3.5, 'w10');
    expect(wall(split, 'w1').b).toEqual({ x: 4, y: 0.5 });
    expect(wall(split, 'w10')).toMatchObject({ a: { x: 4, y: 0.5 }, b: { x: 8.5, y: 0.5 } });
    expect(opening(split, 'o6')).toMatchObject({ wallId: 'w1', offset: 1 });
    expect(opening(split, 'o7')).toMatchObject({ wallId: 'w10', offset: 1 });
    expect(validateFloorplan(split)).toEqual([]);
  });

  it("won't split at an end", () => {
    expect(splitWall(plan, 'w1', 0, 'w10')).toBe(plan);
  });

  it('deletes a wall with its openings', () => {
    const left = deleteWall(plan, 'w1');
    expect(left.walls.map((w) => w.id)).not.toContain('w1');
    expect(left.openings.map((o) => o.id)).not.toContain('o6');
    expect(left.openings).toHaveLength(plan.openings.length - 2);
  });
});

describe('placing openings', () => {
  it('finds the wall under the cursor', () => {
    const hit = nearestWall(plan.walls, { x: 2, y: 0.55 }, 0.1);
    expect(hit?.wall.id).toBe('w1');
    expect(hit?.along).toBeCloseTo(1.5, 9);
    expect(nearestWall(plan.walls, { x: 2, y: 2 }, 0.1)).toBeUndefined();
  });

  it('centers an opening on the cursor, inside the wall', () => {
    expect(centeredOffset(wall(plan, 'w1'), 4, 1)).toBe(3.5);
    expect(centeredOffset(wall(plan, 'w1'), 0.2, 1)).toBe(0);
    expect(centeredOffset(wall(plan, 'w1'), 7.9, 1)).toBe(7);
  });
});

describe('rescalePlan', () => {
  it('scales positions and lengths but not heights', () => {
    const scaled = rescalePlan(plan, 2);
    expect(wall(scaled, 'w1')).toMatchObject({ b: { x: 17, y: 1 }, thickness: 0.4 });
    expect(opening(scaled, 'o6')).toMatchObject({ offset: 2, width: 3, height: 1.24 });
    expect(room(scaled, 'r1').boundary[2]).toEqual({ x: 8, y: 8 });
    expect(scaled.obstacles[0]!.height).toBe(0.9);
  });

  it('moves furniture with the plan, at its own size and turn', () => {
    const sofa = { id: 'f1', articleNo: '123.456.78', roomId: 'r1', x: 2, y: 3, rotation: 1 };
    const scaled = rescalePlan({ ...plan, furniture: [sofa] }, 2);
    expect(scaled.furniture).toEqual([{ ...sofa, x: 4, y: 6 }]);
  });
});
