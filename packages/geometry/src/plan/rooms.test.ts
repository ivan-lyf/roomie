import { Floorplan, type Obstacle } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import {
  floorArea,
  labelsIn,
  obstacleHeight,
  roomAt,
  roomMaterials,
  roomsBeside,
  roomTypeFromLabels,
  wallBreaks,
} from './rooms';

const plan = Floorplan.parse(demo);
const wall = (id: string) => plan.walls.find((w) => w.id === id)!;
const room = (id: string) => plan.rooms.find((r) => r.id === id)!;

describe('rooms beside walls', () => {
  it('finds the room a point is in', () => {
    expect(roomAt(plan.rooms, { x: 2, y: 2 })?.name).toBe('Bedroom');
    expect(roomAt(plan.rooms, { x: 6, y: 6 })?.name).toBe('Kitchen');
    expect(roomAt(plan.rooms, { x: 9, y: 2 })).toBeUndefined();
  });

  it('breaks a wall where the rooms beside it change', () => {
    // The bedroom and the living room meet halfway along the north wall.
    expect(wallBreaks(wall('w1'), plan.rooms)).toEqual([3.5]);
    // Living room, closet and foyer along w9; the kitchen starts at 4.6.
    expect(wallBreaks(wall('w9'), plan.rooms).map((t) => +t.toFixed(6))).toEqual([0.6, 1.2]);
    // Rooms meeting only at its ends don't break it.
    expect(wallBreaks(wall('w5'), plan.rooms)).toEqual([]);
  });

  it('names the room on each side, and none outside', () => {
    // w5 runs south between the bedroom (west, its right) and the living room (east, its left).
    expect(roomsBeside(wall('w5'), 1, plan.rooms)).toEqual({ left: room('r2'), right: room('r1') });
    // The north wall runs east: outside on its left.
    expect(roomsBeside(wall('w1'), 1, plan.rooms)).toEqual({ right: room('r1') });
    expect(roomsBeside(wall('w1'), 6, plan.rooms)).toEqual({ right: room('r2') });
  });
});

describe('roomMaterials', () => {
  it("uses the room's own materials where it has them", () => {
    const tiled = { ...room('r1'), materials: { floor: 'tile' as const } };
    expect(roomMaterials(plan, tiled)).toEqual({ ...plan.materials, floor: 'tile' });
    expect(roomMaterials(plan, { ...tiled, materials: undefined })).toEqual(plan.materials);
  });
});

describe('obstacleHeight', () => {
  const square = (x: number, y: number) => [
    { x, y },
    { x: x + 0.5, y },
    { x: x + 0.5, y: y + 0.5 },
    { x, y: y + 0.5 },
  ];
  const obstacle = (o: Partial<Obstacle>): Obstacle => ({
    id: 'k',
    kind: 'counter',
    polygon: square(5, 6),
    ...o,
  });

  it('uses the drawn height, else a default for the kind', () => {
    expect(obstacleHeight(plan, obstacle({ height: 1.8 }))).toBe(1.8);
    expect(obstacleHeight(plan, obstacle({}))).toBe(0.9);
    expect(obstacleHeight(plan, obstacle({ kind: 'radiator' }))).toBe(0.6);
  });

  it("reaches the ceiling of the obstacle's room, and never past it", () => {
    const rooms = plan.rooms.map((r) => (r.id === 'r1' ? { ...r, ceilingHeight: 3 } : r));
    const loft = { ...plan, rooms };
    expect(obstacleHeight(loft, obstacle({ kind: 'column', polygon: square(1, 1) }))).toBe(3);
    expect(obstacleHeight(loft, obstacle({ kind: 'closet' }))).toBe(2.44);
    expect(obstacleHeight(plan, obstacle({ height: 5 }))).toBe(2.44);
  });
});

describe('labelsIn', () => {
  it("finds the text inside a room's outline, and the type it names", () => {
    const labels = labelsIn(plan, room('r1').boundary);
    expect(labels.map((l) => l.id)).toEqual(['t1', 't2']);
    expect(roomTypeFromLabels(labels)).toBe('bedroom');
    expect(roomTypeFromLabels(labelsIn(plan, room('r5').boundary))).toBe('closet');
    expect(labelsIn({ ...plan, scale: null }, room('r1').boundary)).toEqual([]);
  });
});

describe('floorArea', () => {
  const P = (x: number, y: number) => ({ x, y });
  const wall = (a: { x: number; y: number }, b: { x: number; y: number }, thickness: number) => ({
    a,
    b,
    thickness,
  });
  const rect = [P(0, 0), P(4, 0), P(4, 3), P(0, 3)];

  it('takes half of each wall off its side, and puts the corners right', () => {
    const walls = [
      wall(P(-1, 0), P(5, 0), 0.3),
      wall(P(4, -1), P(4, 4), 0.1),
      wall(P(5, 3), P(-1, 3), 0.3),
      wall(P(0, 4), P(0, -1), 0.1),
    ];
    expect(floorArea(rect, walls)).toBeCloseTo(3.9 * 2.7, 9);
  });

  it('takes nothing off a side with no wall', () => {
    const walls = [
      wall(P(0, 0), P(4, 0), 0.3),
      wall(P(4, 3), P(0, 3), 0.3),
      wall(P(0, 3), P(0, 0), 0.1),
    ];
    expect(floorArea(rect, walls)).toBeCloseTo(3.95 * 2.7, 9);
  });

  it('measures an L inside its walls, either way round', () => {
    const l = [P(0, 0), P(4, 0), P(4, 1), P(1, 1), P(1, 3), P(0, 3)];
    const walls = l.map((a, i) => wall(a, l[(i + 1) % l.length]!, 0.2));
    // Inside: 3.8 × 0.8 along the top, and 0.8 × 2 down the side.
    expect(floorArea(l, walls)).toBeCloseTo(3.8 * 0.8 + 0.8 * 2, 9);
    expect(floorArea(l.toReversed(), walls)).toBeCloseTo(3.8 * 0.8 + 0.8 * 2, 9);
  });
});
