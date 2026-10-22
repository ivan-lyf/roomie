import { Floorplan, type Opening, type Wall } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { roomCeiling, roomWalls, wallHeight } from './rooms';
import { doorSwing, leftNormal, wallLength, wallPieces } from './walls';

const plan = Floorplan.parse(demo);
const wall: Wall = { id: 'w', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.2 };
const opening = (o: Partial<Opening>): Opening => ({
  id: 'o',
  wallId: 'w',
  kind: 'door',
  offset: 1,
  width: 0.9,
  height: 2.03,
  ...o,
});
const span = (p: { center: { x: number }; length: number }) => [
  +(p.center.x - p.length / 2).toFixed(6),
  +(p.center.x + p.length / 2).toFixed(6),
];

describe('wallPieces', () => {
  it('builds a plain wall as one box reaching past both ends to close corners', () => {
    const [piece, ...rest] = wallPieces(wall, [], 2.44);
    expect(rest).toEqual([]);
    expect(span(piece!)).toEqual([-0.1, 4.1]);
    expect(piece).toMatchObject({ bottom: 0, top: 2.44, thickness: 0.2, rotationY: -0 });
  });

  it('leaves a gap for a door, with wall above it', () => {
    const pieces = wallPieces(wall, [opening({})], 2.44);
    expect(pieces.map((p) => [...span(p), p.bottom, p.top])).toEqual([
      [-0.1, 1, 0, 2.44],
      [1, 1.9, 2.03, 2.44],
      [1.9, 4.1, 0, 2.44],
    ]);
  });

  it('keeps wall below and above a window', () => {
    const window = opening({ kind: 'window', offset: 2, width: 1, height: 1.2, sillHeight: 0.9 });
    const pieces = wallPieces(wall, [window], 2.44).filter((p) => p.length === 1);
    expect(pieces.map((p) => [p.bottom, +p.top.toFixed(6)])).toEqual([
      [0, 0.9],
      [2.1, 2.44],
    ]);
  });

  it('clamps openings to the wall and merges overlapping ones', () => {
    const pieces = wallPieces(
      wall,
      [opening({ offset: 3.5, width: 1 }), opening({ id: 'p', kind: 'passage', offset: 3.2 })],
      2.44,
    );
    expect(pieces.filter((p) => p.bottom === 0).map(span)).toEqual([[-0.1, 3.2]]);
  });

  it('turns pieces along their wall', () => {
    const down: Wall = { ...wall, b: { x: 0, y: 4 } };
    expect(wallPieces(down, [], 2.44)[0]?.rotationY).toBeCloseTo(-Math.PI / 2);
  });
});

describe('plan walls and rooms', () => {
  it('finds the walls along a room', () => {
    const bedroom = plan.rooms.find((r) => r.id === 'r1')!;
    expect(roomWalls(bedroom, plan.walls).map((w) => w.id)).toEqual(['w1', 'w4', 'w5', 'w6']);
  });

  it('takes a wall height from the tallest room it bounds', () => {
    const w5 = plan.walls.find((w) => w.id === 'w5')!;
    expect(wallHeight(plan, w5)).toBe(2.44);
    const rooms = plan.rooms.map((r) => (r.id === 'r1' ? { ...r, ceilingHeight: 3 } : r));
    const loft = { ...plan, rooms };
    expect(roomCeiling(loft, loft.rooms[0]!)).toBe(3);
    expect(wallHeight(loft, w5)).toBe(3);
  });

  it('places a door swing on its hinge, opening into its side', () => {
    const w5 = plan.walls.find((w) => w.id === 'w5')!;
    const door = plan.openings.find((o) => o.id === 'o2')!;
    // A JSON round trip turns -0 into 0.
    const swing = JSON.parse(JSON.stringify(doorSwing(w5, door)));
    expect(swing).toEqual({
      hinge: { x: 4, y: 3.8 },
      closed: { x: 0, y: -1 },
      open: { x: -1, y: 0 },
      radius: 0.8,
    });
    expect(wallLength(w5)).toBe(3.5);
    expect(leftNormal({ x: 1, y: 0 })).toEqual({ x: 0, y: -1 });
  });
});
