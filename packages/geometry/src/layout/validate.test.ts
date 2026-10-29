import { type Category, Floorplan, type Placement } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import type { ProductFit } from './shapes';
import { validateLayout } from './validate';

const plan = Floorplan.parse(demo);

// Made-up products: the repo holds no IKEA data.
const item = (category: Category, w: number, d: number, shape: 'rect' | 'round' = 'rect') => ({
  category,
  dims: { w, d, h: 0.8 },
  shape,
});
const CATALOG = {
  queenBed: item('bed', 1.6, 2.1),
  singleBed: item('bed', 0.9, 2.0),
  nightstand: item('nightstand', 0.45, 0.4),
  wardrobe: item('wardrobe', 1.0, 0.6),
  sofa: item('sofa', 2.2, 0.9),
  coffeeTable: item('coffee_table', 1.0, 0.5),
  rug: item('rug', 2.0, 1.4),
  tvUnit: item('tv_unit', 1.5, 0.4),
  armchair: item('armchair', 0.8, 0.8),
  lamp: item('floor_lamp', 0.3, 0.3, 'round'),
  desk: item('desk', 1.2, 0.6),
  deskChair: item('desk_chair', 0.5, 0.5),
  table: item('dining_table', 1.2, 0.8),
  roundTable: item('dining_table', 1.0, 1.0, 'round'),
  chair: item('dining_chair', 0.45, 0.5),
} satisfies Record<string, ProductFit>;
type Name = keyof typeof CATALOG;
const names = Object.keys(CATALOG) as Name[];
const articleNo = (name: Name) => `900.000.${String(names.indexOf(name) + 10)}`;
const products = new Map<string, ProductFit>(names.map((n) => [articleNo(n), CATALOG[n]]));

const Q = Math.PI / 2;
const put = (id: string, name: Name, roomId: string, x: number, y: number, rotation = 0) => ({
  id,
  articleNo: articleNo(name),
  roomId,
  x,
  y,
  rotation,
});

// The demo bedroom's floor runs 0.6–3.94 m across and down; the living room's 4.06–8.4 across
// and 0.6–4.6 down, open to the kitchen below. The bedroom door (o2) is at 3.0–3.8 m down the
// wall between them, hinged at 3.8 and swinging into the bedroom.
const furnished: Placement[] = [
  put('bed', 'queenBed', 'r1', 2.3, 1.65),
  put('ns1', 'nightstand', 'r1', 1.2, 0.8),
  put('ns2', 'nightstand', 'r1', 3.4, 0.8),
  // Against the west wall, facing east.
  put('wardrobe', 'wardrobe', 'r1', 0.9, 3.2, Q),
  // Against the wall to the bedroom, facing east.
  put('sofa', 'sofa', 'r2', 4.51, 1.8, Q),
  put('table', 'coffeeTable', 'r2', 5.6, 1.8, Q),
  put('rug', 'rug', 'r2', 5.6, 1.8, Q),
  // Against the east wall, facing west.
  put('tv', 'tvUnit', 'r2', 8.2, 1.8, -Q),
  put('armchair', 'armchair', 'r2', 7.0, 3.6, 2 * Q),
  put('lamp', 'lamp', 'r2', 8.2, 0.8),
];

const validate = (furniture: Placement[], on = plan) => validateLayout(on, furniture, products);
const codes = (furniture: Placement[], on = plan) => validate(furniture, on).map((p) => p.code);
/** The furnished demo with one item changed. */
const moved = (id: string, change: Partial<Placement>) =>
  furnished.map((p) => (p.id === id ? { ...p, ...change } : p));

describe('validateLayout', () => {
  it('passes the furnished demo home', () => {
    expect(validate(furnished)).toEqual([]);
  });

  it('flags an item it has no product for', () => {
    const unknown = { ...furnished[0]!, articleNo: '999.999.99' };
    expect(validate([unknown])).toEqual([
      expect.objectContaining({ code: 'unknown_product', ids: ['bed'] }),
    ]);
  });

  describe('wrong_room', () => {
    it('flags an item standing in another room than its own', () => {
      const [problem] = validate(moved('sofa', { roomId: 'r1' }));
      expect(problem).toMatchObject({ code: 'wrong_room', ids: ['sofa'] });
      expect(problem!.message).toBe('The sofa stands in the Living, not the Bedroom.');
    });

    it("flags furniture in a room that doesn't get any, or one that's gone", () => {
      expect(validate([put('lamp', 'lamp', 'r3', 6, 5.5)])[0]!.message).toBe(
        "The Kitchen doesn't get furniture.",
      );
      const offPlan = { ...plan, rooms: plan.rooms.map((r) => ({ ...r, furnishable: false })) };
      expect(codes([put('lamp', 'lamp', 'r2', 6, 2)], offPlan)).toEqual(['wrong_room']);
      expect(codes([put('lamp', 'lamp', 'r9', 6, 2)])).toEqual(['wrong_room']);
    });
  });

  describe('outside_room', () => {
    it('flags an item through a wall, but not one flush against it', () => {
      expect(codes(moved('bed', { y: 1.6 }))).toEqual(['outside_room']);
      expect(codes(moved('bed', { y: 1.655 }))).toEqual([]);
    });

    it('flags an item reaching past an open side into the next room', () => {
      // The living room is open to the kitchen at 4.6 m down.
      expect(codes([put('lamp', 'lamp', 'r2', 6, 4.5)])).toEqual(['outside_room']);
      expect(codes([put('lamp', 'lamp', 'r2', 6, 4.44)])).toEqual([]);
    });
  });

  describe('overlap', () => {
    it('flags two items on the same floor', () => {
      const [problem] = validate(moved('lamp', { y: 1.2 }));
      expect(problem).toMatchObject({ code: 'overlap', ids: ['tv', 'lamp'] });
      expect(problem!.message).toBe('The TV unit overlaps the floor lamp.');
    });

    it('lets a rug go under anything but another rug', () => {
      const rugs = [put('rug1', 'rug', 'r2', 6, 2), put('rug2', 'rug', 'r2', 6.5, 2)];
      expect(codes(rugs)).toEqual(['overlap']);
    });

    it('lets a chair go under a table or desk, but not under other furniture', () => {
      const table = put('table', 'table', 'r2', 6, 2.5);
      expect(codes([table, put('c1', 'chair', 'r2', 6, 3.0, 2 * Q)])).toEqual([]);
      const sofa = put('sofa', 'sofa', 'r2', 4.51, 1.8, Q);
      expect(codes([sofa, put('c1', 'chair', 'r2', 4.6, 1.8, Q)])).toEqual(['overlap']);
    });

    it("flags an item on the plan's built-ins", () => {
      const column = { id: 'k9', kind: 'column' as const, polygon: square(5.5, 1.5, 0.3) };
      const withColumn = { ...plan, obstacles: [...plan.obstacles, column] };
      const [problem] = validate(furnished, withColumn);
      expect(problem).toMatchObject({ code: 'overlap', ids: ['table', 'k9'] });
      expect(problem!.message).toBe('The coffee table overlaps the column.');
    });
  });

  describe('blocks_door', () => {
    it('flags an item in the swing of a door', () => {
      const [problem] = validate([...furnished, put('lamp2', 'lamp', 'r1', 3.6, 3.4)]);
      expect(problem).toMatchObject({ code: 'blocks_door', ids: ['lamp2', 'o2'] });
      expect(problem!.message).toBe('The floor lamp blocks the door to the Living.');
    });

    it('flags an item in front of a door on the side it does not swing to', () => {
      const [problem] = validate([...furnished, put('lamp2', 'lamp', 'r2', 4.3, 3.4)]);
      expect(problem).toMatchObject({ code: 'blocks_door', ids: ['lamp2', 'o2'] });
      expect(problem!.message).toBe('The floor lamp blocks the door to the Bedroom.');
    });

    it('lets a rug lie in front of a door', () => {
      expect(codes([put('rug', 'rug', 'r1', 2.9, 3.2)])).toEqual([]);
    });
  });

  describe('no_clearance', () => {
    it('keeps legroom in front of a sofa, with a rug allowed in it', () => {
      const [problem] = validate(moved('table', { x: 5.25 }));
      expect(problem).toMatchObject({ code: 'no_clearance', ids: ['sofa', 'table'] });
      expect(problem!.message).toBe(
        'The sofa needs 35 cm clear in front for legroom: the coffee table is in the way.',
      );
    });

    it('keeps a double bed open on both sides, and a single bed on one', () => {
      // Pushed against the west wall.
      const queen = put('bed', 'queenBed', 'r1', 1.4, 1.65);
      const [problem] = validate([queen]);
      expect(problem).toMatchObject({ code: 'no_clearance', ids: ['bed', 'w4'] });
      expect(problem!.message).toBe(
        'The bed needs 60 cm clear along both sides to get in and out: a wall is in the way.',
      );
      expect(codes([put('bed', 'singleBed', 'r1', 1.05, 1.6)])).toEqual([]);
      // A single bed boxed in by a wall and a wardrobe has no way in.
      const boxed = [
        put('bed', 'singleBed', 'r1', 1.05, 1.6),
        put('w', 'wardrobe', 'r1', 2.0, 1.8, Q),
      ];
      expect(codes(boxed)).toEqual(['no_clearance']);
    });

    it('lets nightstands stand by the head of a bed, but not along its side', () => {
      expect(codes(moved('ns1', { y: 2.2 }))).toEqual(['no_clearance']);
    });

    it('keeps the front of storage clear to open it', () => {
      // Facing the bed's foot 30 cm away.
      const wardrobe = put('wardrobe', 'wardrobe', 'r1', 2.3, 3.3, 2 * Q);
      expect(codes([put('bed', 'queenBed', 'r1', 2.3, 1.65), wardrobe])).toEqual(['no_clearance']);
    });

    it('keeps room for chairs at a desk and around a dining table', () => {
      const desk = put('desk', 'desk', 'r2', 6, 0.9);
      expect(codes([desk, put('c', 'deskChair', 'r2', 6, 1.4, 2 * Q)])).toEqual([]);
      expect(codes([desk, put('a', 'armchair', 'r2', 6, 1.8)])).toEqual(['no_clearance']);
      // A round table needs space all round: not against the north wall.
      expect(codes([put('t', 'roundTable', 'r2', 6, 2.5)])).toEqual([]);
      expect(codes([put('t', 'roundTable', 'r2', 6, 1.1)])).toEqual(['no_clearance']);
    });
  });
});

function square(x: number, y: number, size: number) {
  const h = size / 2;
  return [
    { x: x - h, y: y - h },
    { x: x + h, y: y - h },
    { x: x + h, y: y + h },
    { x: x - h, y: y + h },
  ];
}
