import { describe, expect, it } from 'vitest';
import { liveFurniture, PREVIEW_ID } from './furnishing';

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
