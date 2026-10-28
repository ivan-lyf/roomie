import { Floorplan } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { planStatus, validateFloorplan } from './validate';

const plan = Floorplan.parse(demo);
const codes = (p: Floorplan) => validateFloorplan(p).map((problem) => problem.code);

describe('validateFloorplan', () => {
  it('passes the demo home', () => {
    expect(validateFloorplan(plan)).toEqual([]);
  });

  it('needs a scale', () => {
    expect(codes({ ...plan, scale: null })).toEqual(['no_scale']);
  });

  it('flags openings off their wall, overlapping or too tall', () => {
    const openings = plan.openings.map((o) => {
      if (o.id === 'o2') return { ...o, offset: 3 };
      if (o.id === 'o7') return { ...o, offset: 2.0 };
      if (o.id === 'o8') return { ...o, height: 2 };
      return o;
    });
    expect(codes({ ...plan, openings }).sort()).toEqual([
      'opening_off_wall',
      'opening_too_tall',
      'openings_overlap',
    ]);
  });

  it('flags an opening on a missing wall, and a room too small to be real', () => {
    const openings = [...plan.openings, { ...plan.openings[0]!, id: 'x', wallId: 'nope' }];
    const rooms = plan.rooms.map((r) =>
      r.id === 'r5' ? { ...r, boundary: [r.boundary[0]!, r.boundary[1]!, r.boundary[0]!] } : r,
    );
    expect(codes({ ...plan, openings, rooms }).sort()).toEqual(['room_too_small', 'unknown_wall']);
  });
});

describe('more checks', () => {
  it('needs rooms, and flags overlapping rooms and stub walls', () => {
    expect(codes({ ...plan, rooms: [] })).toEqual(['no_rooms']);
    const rooms = plan.rooms.map((r) =>
      r.id === 'r1' ? { ...r, boundary: r.boundary.map((p) => ({ x: p.x + 1, y: p.y })) } : r,
    );
    expect(codes({ ...plan, rooms })).toEqual(['rooms_overlap']);
    const stub = { id: 'w10', a: { x: 1, y: 1 }, b: { x: 1.05, y: 1 }, thickness: 0.12 };
    const walls = [...plan.walls, stub];
    expect(codes({ ...plan, walls })).toEqual(['wall_too_short']);
  });

  it('lets rooms share edges and corners', () => {
    expect(codes(plan)).toEqual([]);
  });

  it("doesn't take an L-shaped hall for overlapping the room in its crook", () => {
    // The hall runs along the top and down the right of the bedroom; its centroid is in the
    // bedroom.
    const P = (x: number, y: number) => ({ x, y });
    const room = (id: string, boundary: { x: number; y: number }[]) => ({
      ...plan.rooms[0]!,
      id,
      boundary,
    });
    const rooms = [
      room('hall', [P(1, 0), P(8, 0), P(8, 5), P(7, 5), P(7, 1), P(1, 1)]),
      room('bedroom', [P(3, 1), P(7, 1), P(7, 5), P(3, 5)]),
    ];
    expect(codes({ ...plan, rooms })).toEqual([]);
  });

  it('lets rooms share an edge that leans a hair apart in floating point', () => {
    const P = (x: number, y: number) => ({ x, y });
    const room = (id: string, boundary: { x: number; y: number }[]) => ({
      ...plan.rooms[0]!,
      id,
      boundary,
    });
    // A bath with a closet beside it, its corner on the bath's side wall: a T.
    const rooms = [
      room('a', [P(0.5, 3.98), P(2.495628822275011, 3.98), P(2.495628822275013, 7), P(0.5, 7)]),
      room('b', [
        P(2.4956288222750116, 3.98),
        P(4, 3.98),
        P(4, 5.21),
        P(2.4956288222750116, 5.21),
      ]),
    ];
    expect(codes({ ...plan, rooms })).toEqual([]);
  });
});

describe('planStatus', () => {
  it('is ready once it has a scale and rooms and no problems', () => {
    expect(planStatus(plan)).toBe('ready');
    expect(planStatus({ ...plan, scale: null })).toBe('needs_calibration');
    expect(planStatus({ ...plan, rooms: [] })).toBe('uploaded');
  });
});
