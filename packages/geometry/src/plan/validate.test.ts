import { Floorplan } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { validateFloorplan } from './validate';

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
