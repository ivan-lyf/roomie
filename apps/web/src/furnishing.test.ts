import { describe, expect, it } from 'vitest';
import { furnitureTotals, liveFurniture, PREVIEW_ID, whyOf } from './furnishing';

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
