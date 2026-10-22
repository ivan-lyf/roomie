import { pointAlong, roomsBeside } from '@roomie/geometry';
import { Floorplan } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { inTheWay, type Stretch } from './cutaway';

const plan = Floorplan.parse(demo);
/** The stretch of a wall `at` meters along it. */
const stretch = (wallId: string, at: number): Stretch => {
  const wall = plan.walls.find((w) => w.id === wallId)!;
  return { wall, center: pointAlong(wall, at), ...roomsBeside(wall, at, plan.rooms) };
};
// Over the plan, south-east of the home and north-west of it.
const southEast = { x: 12, y: 11 };
const northWest = { x: -3, y: -3 };

describe('inTheWay', () => {
  it('drops the outside walls facing the camera when looking at the whole home', () => {
    // South (w3) and east (w2) walls block the view from the south-east; north (w1) doesn't.
    expect(inTheWay(stretch('w3', 2), undefined, southEast)).toBe(true);
    expect(inTheWay(stretch('w2', 2), undefined, southEast)).toBe(true);
    expect(inTheWay(stretch('w1', 2), undefined, southEast)).toBe(false);
    expect(inTheWay(stretch('w1', 2), undefined, northWest)).toBe(true);
    // Walls between two rooms stay up.
    expect(inTheWay(stretch('w5', 1), undefined, southEast)).toBe(false);
  });

  it("keeps only the picked room's walls on its far side", () => {
    // From the south-east, the bedroom's north (w1) and west (w4) walls are its backdrop.
    expect(inTheWay(stretch('w1', 1), 'r1', southEast)).toBe(false);
    expect(inTheWay(stretch('w4', 5), 'r1', southEast)).toBe(false);
    // Its east (w5) and south (w6) walls face the camera.
    expect(inTheWay(stretch('w5', 1), 'r1', southEast)).toBe(true);
    expect(inTheWay(stretch('w6', 1), 'r1', southEast)).toBe(true);
    // Other rooms' walls are all in the way, even the living room's part of the north wall.
    expect(inTheWay(stretch('w7', 1), 'r1', southEast)).toBe(true);
    expect(inTheWay(stretch('w1', 6), 'r1', southEast)).toBe(true);
    // Turned around, the backdrop changes sides.
    expect(inTheWay(stretch('w1', 1), 'r1', northWest)).toBe(true);
    expect(inTheWay(stretch('w5', 1), 'r1', northWest)).toBe(false);
  });

  it("keeps all the room's walls up when looking straight down into it", () => {
    for (const s of [stretch('w1', 1), stretch('w4', 5), stretch('w5', 1), stretch('w6', 1)]) {
      expect(inTheWay(s, 'r1', { x: 2.25, y: 2.25 })).toBe(false);
    }
  });
});
