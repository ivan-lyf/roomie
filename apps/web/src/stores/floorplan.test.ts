import { Floorplan, type PlanDraft } from '@roomie/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { redo, undo, useFloorplan } from './floorplan';

const plan = Floorplan.parse(demo);
const room = (id: string) => useFloorplan.getState().plan!.rooms.find((r) => r.id === id)!;

describe('floorplan store', () => {
  beforeEach(() => useFloorplan.getState().load(plan));

  it("changes the home's materials", () => {
    useFloorplan.getState().setMaterials(undefined, { wallColor: '#ffffff' });
    expect(useFloorplan.getState().plan!.materials).toEqual({
      ...plan.materials,
      wallColor: '#ffffff',
    });
    expect(room('r1').materials).toBeUndefined();
  });

  it('overrides materials in one room, and resets them', () => {
    const { setMaterials, resetRoomMaterials } = useFloorplan.getState();
    setMaterials('r1', { floor: 'carpet' });
    setMaterials('r1', { wallColor: '#c9d3c0' });
    expect(room('r1').materials).toEqual({ floor: 'carpet', wallColor: '#c9d3c0' });
    expect(useFloorplan.getState().plan!.materials).toEqual(plan.materials);
    resetRoomMaterials('r1');
    expect(room('r1')).not.toHaveProperty('materials');
    expect(room('r4').materials).toEqual({ floor: 'tile' });
  });
});

const state = () => useFloorplan.getState();
const current = () => state().plan!;
const history = () => useFloorplan.temporal.getState();

describe('editing the plan', () => {
  beforeEach(() => state().load(plan));

  it('starts a loaded plan with nothing to undo', () => {
    expect(history().pastStates).toHaveLength(0);
  });

  it('undoes and redoes each edit', () => {
    state().movePoint({ x: 8.5, y: 0.5 }, { x: 9, y: 0.5 });
    state().rename('Moved');
    expect(history().pastStates).toHaveLength(2);
    undo();
    expect(current().name).toBe(plan.name);
    expect(current().walls.find((w) => w.id === 'w1')!.b).toEqual({ x: 9, y: 0.5 });
    undo();
    expect(current()).toEqual(plan);
    redo();
    redo();
    expect(current().name).toBe('Moved');
  });

  it('draws walls and puts openings in them', () => {
    const wallId = state().addWall({ x: 9, y: 0 }, { x: 13, y: 0 }, 0.15);
    expect(wallId).toBe('w10');
    const doorId = state().addOpening('door', wallId, 0.1)!;
    expect(current().openings.find((o) => o.id === doorId)).toMatchObject({
      offset: 0,
      width: 0.8,
      height: 2.03,
      swing: { hinge: 'start', side: 'left' },
    });
    state().flipHinge(doorId);
    state().flipSide(doorId);
    state().setOpening(doorId, { offset: 10, width: 0.9 });
    expect(current().openings.find((o) => o.id === doorId)).toMatchObject({
      offset: 3.1,
      width: 0.9,
      swing: { hinge: 'end', side: 'right' },
    });
    const windowId = state().addOpening('window', wallId, 2)!;
    expect(current().openings.find((o) => o.id === windowId)).toMatchObject({
      offset: 1.4,
      sillHeight: 0.9,
    });
  });

  it('removes a wall with its openings, and other things by id', () => {
    state().remove(['w1', 'r5', 'k1', 'o1']);
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    expect(ids(current().walls)).not.toContain('w1');
    expect(ids(current().openings)).not.toEqual(expect.arrayContaining(['o1', 'o6', 'o7']));
    expect(ids(current().rooms)).not.toContain('r5');
    expect(ids(current().obstacles)).toEqual(['k2']);
    undo();
    expect(current()).toEqual(plan);
  });

  it('names and types a new room from the labels inside it', () => {
    state().remove(['r1']);
    const roomId = state().addRoom(room0.boundary);
    expect(current().rooms.find((r) => r.id === roomId)).toMatchObject({
      name: 'Bedroom',
      roomType: 'bedroom',
      labelTextIds: ['t1', 't2'],
      furnishable: true,
    });
    const another = state().addRoom([
      { x: 20, y: 20 },
      { x: 23, y: 20 },
      { x: 23, y: 23 },
    ]);
    expect(current().rooms.find((r) => r.id === another)).toMatchObject({
      name: 'Room',
      roomType: 'other',
      furnishable: false,
    });
  });

  it('splits a room along a line and merges it back', () => {
    // The living room, cut into living and dining at x = 6.
    expect(state().splitRoom('r2', { x: 6, y: 0 }, { x: 6, y: 5 })).toBe(true);
    const halves = current().rooms.filter((r) => r.id === 'r2' || r.id === 'r7');
    expect(halves.map((r) => r.labelTextIds)).toEqual([['t3', 't4'], []]);
    expect(halves[1]).toMatchObject({ name: 'Living room', roomType: 'living_room' });
    state().setRoom('r7', { roomType: 'dining_area', name: 'Dining' });
    expect(state().mergeRooms('r2', 'r7')).toBe(true);
    expect(current().rooms.find((r) => r.id === 'r2')!.boundary).toHaveLength(4);
    expect(current().rooms).toHaveLength(plan.rooms.length);
    expect(state().splitRoom('r2', { x: 6, y: 1 }, { x: 6, y: 2 })).toBe(false);
  });

  it('sets a room type with its furnishing default, and ceiling overrides', () => {
    state().setRoom('r1', { roomType: 'den_office' });
    expect(room('r1')).toMatchObject({ roomType: 'den_office', furnishable: true });
    state().setRoom('r1', { roomType: 'closet', furnishable: true });
    expect(room('r1').furnishable).toBe(true);
    state().setRoom('r1', { ceilingHeight: 3 });
    expect(room('r1').ceilingHeight).toBe(3);
    state().setRoom('r1', { ceilingHeight: undefined });
    expect(room('r1')).not.toHaveProperty('ceilingHeight');
  });

  it('rescales everything for a new scale, and sets the ceiling', () => {
    state().calibrate({ ...plan.scale!, metersPerPixel: 0.011, method: 'wall_length' });
    expect(current().walls[0]!.b.x).toBeCloseTo(9.35, 9);
    expect(current().walls[0]!.b.y).toBeCloseTo(0.55, 9);
    expect(current().scale?.method).toBe('wall_length');
    state().setCeiling(2.7);
    expect(current()).toMatchObject({ ceilingHeight: 2.7, ceilingHeightSource: 'user' });
  });
});

const room0 = plan.rooms[0]!;

describe('furnishing', () => {
  beforeEach(() => state().load(plan));

  it('places, moves and removes items, each one edit to undo', () => {
    const sofa = { articleNo: '123.456.78', roomId: 'r2', x: 5, y: 2, rotation: 0 };
    const first = state().placeItem(sofa);
    const second = state().placeItem({ ...sofa, x: 7 });
    expect([first, second]).toEqual(['f1', 'f2']);
    state().moveItem(first, { x: 6, rotation: Math.PI });
    expect(current().furniture[0]).toEqual({ id: 'f1', ...sofa, x: 6, rotation: Math.PI });
    state().remove([second]);
    expect(current().furniture.map((f) => f.id)).toEqual(['f1']);
    undo();
    expect(current().furniture.map((f) => f.id)).toEqual(['f1', 'f2']);
    undo();
    expect(current().furniture[0]!.x).toBe(5);
    redo();
    expect(current().furniture[0]!.x).toBe(6);
  });

  it('swaps an item for another product, keeping its id and ref, as one edit', () => {
    const sofa = { id: 'f1', articleNo: '123.456.78', roomId: 'r2', x: 5, y: 2, rotation: 0 };
    state().setFurniture([{ ...sofa, ref: 'sofa' }]);
    state().swapItem('f1', { articleNo: '876.543.21', x: 5, y: 2.05, rotation: 0 });
    expect(current().furniture).toEqual([
      { ...sofa, ref: 'sofa', articleNo: '876.543.21', y: 2.05 },
    ]);
    undo();
    expect(current().furniture[0]!.articleNo).toBe('123.456.78');
  });

  it('clears a room, and puts in a furnished layout, each one edit to undo', () => {
    const item = (id: string, roomId: string) => ({
      id,
      articleNo: '123.456.78',
      roomId,
      x: 5,
      y: 2,
      rotation: 0,
    });
    state().setFurniture([item('f1', 'r1'), item('f2', 'r2'), item('f3', 'r2')]);
    state().remove(['f2', 'f3']);
    expect(current().furniture.map((f) => f.id)).toEqual(['f1']);
    expect(history().pastStates).toHaveLength(2);
    undo();
    expect(current().furniture.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    undo();
    expect(current().furniture).toEqual([]);
    expect(history().pastStates).toHaveLength(0);
  });
});

describe('a plan the reader read', () => {
  const P = (x: number, y: number) => ({ x, y });
  const draft: PlanDraft = {
    walls: [
      { id: 'w1', a: P(100, 100), b: P(500, 100), thickness: 15 },
      { id: 'w2', a: P(500, 100), b: P(500, 400), thickness: 15 },
      { id: 'w3', a: P(500, 400), b: P(100, 400), thickness: 15 },
      { id: 'w4', a: P(100, 400), b: P(100, 100), thickness: 15 },
    ],
    openings: [{ id: 'o1', wallId: 'w1', kind: 'window', offset: 100, width: 120 }],
    rooms: [{ id: 'r1', polygon: [P(100, 100), P(500, 100), P(500, 400), P(100, 400)] }],
    obstacles: [],
    texts: [{ id: 't1', text: 'LIVING', bbox: { x: 270, y: 240, w: 60, h: 20 } }],
  };
  const unscaled: Floorplan = {
    ...plan,
    walls: [],
    openings: [],
    rooms: [],
    obstacles: [],
    labels: [],
    scale: null,
    reading: {
      provider: 'gemini',
      model: 'gemini-test',
      promptVersion: 'plan-read.v1',
      durationMs: 1000,
      raw: null,
      draft,
      scaleCandidates: [
        {
          metersPerPixel: 0.0125,
          sourceUnit: 'imperial',
          method: 'labels',
          inputs: {},
          residual: 0.01,
          plausible: true,
        },
      ],
    },
  };
  beforeEach(() => state().load(unscaled));

  it('converts its draft when the scale is set, checking labels in their unit', () => {
    state().calibrate({
      metersPerPixel: 0.012,
      sourceUnit: 'none',
      method: 'wall_length',
      inputs: {},
      residual: 0,
    });
    expect(current().walls[0]).toMatchObject({ a: { x: 1.2, y: 1.2 }, thickness: 0.18 });
    expect(current().rooms[0]).toMatchObject({ name: 'Living', roomType: 'living_room' });
    expect(current().openings[0]).toMatchObject({ width: 1.44, sillHeight: 0.9 });
    expect(current().scale?.sourceUnit).toBe('imperial');
    undo();
    expect(current()).toEqual(unscaled);
  });

  it('takes a fresh reading as one edit to undo', () => {
    state().replace({ ...unscaled, name: 'Read again' });
    expect(current().name).toBe('Read again');
    undo();
    expect(current().name).toBe(plan.name);
    expect(state().loaded).toBe(unscaled);
  });
});
