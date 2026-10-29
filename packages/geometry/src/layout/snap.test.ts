import { type Category, Floorplan, type Wall } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { snapPlacement, turn } from './snap';

const plan = Floorplan.parse(demo);
const item = (category: Category, w: number, d: number, shape: 'rect' | 'round' = 'rect') => ({
  category,
  dims: { w, d, h: 0.8 },
  shape,
});
const sofa = item('sofa', 2.2, 0.9);
const singleBed = item('bed', 0.9, 2.0);
const nightstand = item('nightstand', 0.4, 0.4);
const Q = Math.PI / 2;

/** A snapped spot, to the millimeter. */
const snap = (
  product: ReturnType<typeof item>,
  x: number,
  y: number,
  rotation: number,
  roomId: string,
  on = plan,
) => {
  const s = snapPlacement({ x, y, rotation, roomId }, product, on);
  const mm = (n: number) => +n.toFixed(3) || 0;
  return { x: mm(s.x), y: mm(s.y), rotation: mm(s.rotation) };
};

// The living room's west wall face is at x = 4.06, the bedroom's at 0.6 and its north at 0.6.
describe('snapPlacement', () => {
  // Facing east, its back to the west wall, and into the corner with the north wall.
  const against = { x: 4.51, y: 1.7, rotation: +Q.toFixed(3) };

  it('turns an item near a wall to put its back flush against it', () => {
    expect(snap(sofa, 4.6, 1.8, Q + 0.2, 'r2')).toEqual(against);
  });

  it('turns an item facing the wall round', () => {
    expect(snap(sofa, 4.6, 1.8, -Q, 'r2')).toEqual(against);
  });

  it('puts a side flush when the side is to the wall', () => {
    expect(snap(singleBed, 1.15, 2.2, 0.1, 'r1')).toEqual({ x: 1.05, y: 2.2, rotation: 0 });
  });

  it('slides into a corner within reach of a second wall', () => {
    expect(snap(singleBed, 1.1, 1.65, 0, 'r1')).toEqual({ x: 1.05, y: 1.6, rotation: 0 });
  });

  it('pushes an item dragged into a wall back out', () => {
    expect(snap(singleBed, 0.9, 2.2, 0, 'r1')).toEqual({ x: 1.05, y: 2.2, rotation: 0 });
  });

  it('leaves alone an item away from the walls, and a rug anywhere', () => {
    expect(snap(sofa, 6, 2.5, 0.3, 'r2')).toEqual({ x: 6, y: 2.5, rotation: 0.3 });
    expect(snap(item('rug', 2, 1.4), 4.8, 1.8, 0, 'r2')).toEqual({ x: 4.8, y: 1.8, rotation: 0 });
  });

  it("doesn't snap to the living room's open side", () => {
    // The living room is open to the kitchen at 4.6 m down.
    expect(snap(nightstand, 6, 4.35, 0, 'r2')).toEqual({ x: 6, y: 4.35, rotation: 0 });
  });

  it("doesn't snap into a doorway's space when it was clear of it", () => {
    // A 4 m square room with an open doorway in its east wall, 0.4–1.2 m down.
    const P = (x: number, y: number) => ({ x, y });
    const corners = [P(0, 0), P(4, 0), P(4, 4), P(0, 4)];
    const walls: Wall[] = corners.map((a, i) => ({
      id: `w${i + 1}`,
      a,
      b: corners[(i + 1) % 4]!,
      thickness: 0.1,
    }));
    const room = { ...plan.rooms[1]!, id: 'r1', boundary: corners };
    const doorway = {
      id: 'o1',
      wallId: 'w2',
      kind: 'passage' as const,
      offset: 0.4,
      width: 0.8,
      height: 2,
    };
    const square = { ...plan, walls, rooms: [room], openings: [doorway], obstacles: [] };
    // Pushed out of the north wall, it would reach into the doorway's space.
    expect(snap(nightstand, 3.6, 0.15, 0, 'r1', square)).toEqual({ x: 3.6, y: 0.15, rotation: 0 });
    // Further from the doorway, it snaps, however the room was outlined.
    expect(snap(nightstand, 2.0, 0.15, 0, 'r1', square)).toEqual({ x: 2.0, y: 0.25, rotation: 0 });
    const reversed = { ...square, rooms: [{ ...room, boundary: corners.toReversed() }] };
    expect(snap(nightstand, 2.0, 0.15, 0, 'r1', reversed)).toEqual({ x: 2.0, y: 0.25, rotation: 0 });
  });
});

describe('turn', () => {
  it('keeps rotations within a half turn either way', () => {
    expect(turn(Q, Q)).toBeCloseTo(Math.PI);
    expect(turn(Math.PI, Q)).toBeCloseTo(-Q);
    expect(turn(-Q, -Q * 2)).toBeCloseTo(Q);
  });
});
