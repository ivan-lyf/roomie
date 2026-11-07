import { Floorplan } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../fixtures/plans/00-demo-1br/floorplan.json';
import { longWalls, pixelPlan, scaleFromTotal, scaleFromWall, sizeSummary } from './check';

const plan = Floorplan.parse(demo);
const mpp = plan.scale!.metersPerPixel;

describe('the size question', () => {
  it("shows a bedroom's sides and the home's floor area", () => {
    const { room, homeArea } = sizeSummary(plan);
    expect(room?.name).toMatch(/bed/i);
    expect(room!.width).toBeGreaterThanOrEqual(room!.depth);
    expect(room!.depth).toBeGreaterThan(2);
    expect(homeArea).toBeGreaterThan(20);
    expect(homeArea).toBeLessThan(120);
  });

  it('has no room to show on a plan without rooms', () => {
    expect(sizeSummary({ ...plan, rooms: [] })).toEqual({ homeArea: 0 });
  });
});

describe('setting the size', () => {
  const pixels = pixelPlan(plan);

  it('puts a sized plan back in image pixels', () => {
    const wall = plan.walls[0]!;
    const back = pixels.walls[0]!;
    expect(back.a.x * mpp).toBeCloseTo(wall.a.x, 9);
    expect(pixels.rooms).toHaveLength(plan.rooms.length);
  });

  it('asks about the longest walls first', () => {
    const [first, second] = longWalls(pixels.walls);
    const len = (w: typeof first) => Math.hypot(w!.b.x - w!.a.x, w!.b.y - w!.a.y);
    expect(len(first)).toBeGreaterThanOrEqual(len(second));
  });

  it("from one wall's length gives back the size the plan has", () => {
    const wall = longWalls(pixels.walls)[0]!;
    const meters = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) * mpp;
    const scale = scaleFromWall(wall, meters, 'imperial', '20 ft');
    expect(scale.metersPerPixel).toBeCloseTo(mpp, 9);
    expect(scale.method).toBe('wall_length');
  });

  it("from the home's total area gives back the size the plan has", () => {
    const { homeArea } = sizeSummary(plan);
    const scale = scaleFromTotal(pixels, homeArea, 'unsure', 'imperial', `${homeArea} m²`)!;
    expect(scale.metersPerPixel / mpp).toBeCloseTo(1, 2);
  });

  it('counts closets and balconies only when the figure includes them', () => {
    const rooms = [
      { id: 'a', name: 'Living', polygon: square(0, 100) },
      { id: 'b', name: 'Balcony', polygon: square(100, 50) },
      { id: 'c', name: 'WIC', polygon: square(200, 20) },
    ];
    const at = (includes: 'yes' | 'no' | 'unsure') =>
      scaleFromTotal({ walls: [], rooms }, 10, includes, 'none', '')!.inputs['pixelArea'];
    expect(at('yes')).toBe(100 ** 2 + 50 ** 2 + 20 ** 2);
    expect(at('no')).toBe(100 ** 2);
    expect(at('unsure')).toBe(100 ** 2 + 20 ** 2);
    expect(scaleFromTotal({ walls: [], rooms: [] }, 10, 'yes', 'none', '')).toBeUndefined();
  });
});

const square = (x: number, side: number) => [
  { x, y: 0 },
  { x: x + side, y: 0 },
  { x: x + side, y: side },
  { x, y: side },
];
