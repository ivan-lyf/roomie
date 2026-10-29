import { describe, expect, it } from 'vitest';
import {
  BUDGET_PER_ROOM,
  furnitureTotals,
  liveFurniture,
  PREVIEW_ID,
  problemsByRoom,
  roomBudget,
  whyOf,
} from './furnishing';

const sofa = { id: 'f1', articleNo: '123.456.78', roomId: 'r2', x: 5, y: 2, rotation: 0 };
const lamp = { ...sofa, id: 'f2', articleNo: '876.543.21', x: 7 };

describe('liveFurniture', () => {
  it('is the furniture as saved when nothing moves', () => {
    expect(liveFurniture([sofa, lamp], undefined, undefined)).toEqual([sofa, lamp]);
  });

  it('puts the item being dragged where it is now', () => {
    const preview = { id: 'f2', x: 4.5, y: 3, rotation: 1, roomId: 'r1' };
    expect(liveFurniture([sofa, lamp], undefined, preview)).toEqual([
      sofa,
      { ...lamp, x: 4.5, y: 3, rotation: 1, roomId: 'r1' },
    ]);
  });

  it('shows an item as the product it would be swapped for', () => {
    const preview = { id: 'f1', x: 5, y: 2.1, rotation: 0, roomId: 'r2', articleNo: '111.111.11' };
    expect(liveFurniture([sofa, lamp], undefined, preview)).toEqual([
      { ...sofa, y: 2.1, articleNo: '111.111.11' },
      lamp,
    ]);
  });

  it('adds a product about to be placed', () => {
    const preview = { x: 6, y: 1, rotation: 0, roomId: 'r2' };
    const armed = { articleNo: '111.111.11' };
    expect(liveFurniture([sofa], armed, preview)).toEqual([
      sofa,
      { id: PREVIEW_ID, articleNo: '111.111.11', ...preview },
    ]);
    expect(liveFurniture([sofa], undefined, preview)).toEqual([sofa]);
  });
});

describe('furnitureTotals', () => {
  it('counts and prices the home and each room', () => {
    const products = new Map([
      ['123.456.78', { priceCad: 899 }],
      ['876.543.21', { priceCad: 49.99 }],
    ]);
    const chair = { ...lamp, id: 'f3', articleNo: '000.000.00', roomId: 'r1' };
    const { home, byRoom } = furnitureTotals([sofa, lamp, chair], products);
    expect(home).toEqual({ count: 3, priceCad: 948.99 });
    expect(byRoom.get('r2')).toEqual({ count: 2, priceCad: 948.99 });
    expect(byRoom.get('r1')).toEqual({ count: 1, priceCad: 0 });
  });
});

describe('whyOf', () => {
  const furnishing = {
    budgetCad: 3000,
    style: 'scandinavian' as const,
    rooms: [
      {
        roomId: 'r2',
        layoutId: '00000000-0000-4000-8000-000000000000',
        intent: {
          roomId: 'r2',
          items: [{ ref: 'sofa', articleNo: '123.456.78', why: 'Seats three, facing the TV.' }],
          relations: [],
        },
        placements: [],
      },
    ],
  };

  it("gives the intent's reason for an item it chose", () => {
    expect(whyOf({ ...sofa, ref: 'sofa' }, furnishing)).toBe('Seats three, facing the TV.');
  });

  it('has none once the item is swapped, moved to another room, or was placed by hand', () => {
    expect(whyOf({ ...sofa, ref: 'sofa', articleNo: '876.543.21' }, furnishing)).toBeUndefined();
    expect(whyOf({ ...sofa, ref: 'sofa', roomId: 'r1' }, furnishing)).toBeUndefined();
    expect(whyOf(sofa, furnishing)).toBeUndefined();
    expect(whyOf({ ...sofa, ref: 'sofa' }, undefined)).toBeUndefined();
  });
});

describe('problemsByRoom', () => {
  it("counts each room's problems, its walkways' included, and one between rooms in both", () => {
    const chair = { ...sofa, id: 'f3', roomId: 'r1' };
    const problems = [
      { code: 'overlap' as const, message: '', ids: ['f1', 'f2'] },
      { code: 'overlap' as const, message: '', ids: ['f1', 'f3'] },
      { code: 'blocks_door' as const, message: '', ids: ['f3', 'o1'] },
      { code: 'blocks_path' as const, message: '', ids: [], roomId: 'r4' },
    ];
    expect(problemsByRoom(problems, [sofa, lamp, chair])).toEqual(
      new Map([
        ['r2', 2],
        ['r1', 2],
        ['r4', 1],
      ]),
    );
  });
});

describe('roomBudget', () => {
  const products = new Map([
    ['123.456.78', { priceCad: 899 }],
    ['876.543.21', { priceCad: 50 }],
  ]);
  const home = { budgetCad: 2400, style: 'modern' as const, rooms: [] };
  const bed = { ...sofa, id: 'f3', roomId: 'r1' };

  it("is the room's share in its last intent", () => {
    const room = {
      roomId: 'r1',
      layoutId: '00000000-0000-4000-8000-000000000000',
      intent: { roomId: 'r1', items: [], relations: [] },
      placements: [],
      budgetCad: 650.4,
    };
    expect(roomBudget({ ...home, rooms: [room] }, [sofa, bed], products, 'r1')).toBe(650);
  });

  it("is else what's left of the home's budget, or else a room's starting budget", () => {
    expect(roomBudget(home, [sofa, lamp, bed], products, 'r1')).toBe(2400 - 949);
    expect(roomBudget({ ...home, budgetCad: 900 }, [sofa, lamp], products, 'r1')).toBe(
      BUDGET_PER_ROOM,
    );
    expect(roomBudget(undefined, [sofa], products, 'r1')).toBe(BUDGET_PER_ROOM);
  });
});
