import type { HomeFurnishing, Placement } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { whyHere } from './whyHere';

const sofa: Placement = { id: 'f1', articleNo: '1', roomId: 'r1', x: 2, y: 1, rotation: 0, ref: 'sofa' };
const furnishing = {
  budgetCad: 2000,
  style: 'modern',
  rooms: [
    {
      roomId: 'r1',
      layoutId: '00000000-0000-4000-8000-000000000001',
      placements: [sofa],
      intent: {
        roomId: 'r1',
        items: [{ ref: 'sofa', articleNo: '1', why: 'Against the longest wall, facing the TV.' }],
        relations: [],
      },
    },
  ],
} as unknown as HomeFurnishing;

describe('why here', () => {
  it("gives the reason while the piece stands where it was put", () => {
    expect(whyHere(sofa, furnishing)).toBe('Against the longest wall, facing the TV.');
  });

  it('says the user placed it once moved, or added by hand', () => {
    expect(whyHere({ ...sofa, x: 2.5 }, furnishing)).toBe('You placed this.');
    const byHand: Placement = { id: 'f9', articleNo: '1', roomId: 'r1', x: 3, y: 1, rotation: 0 };
    expect(whyHere(byHand, furnishing)).toBe('You placed this.');
  });

  it('says nothing for a home furnished by hand only', () => {
    expect(whyHere(sofa, undefined)).toBeUndefined();
  });
});
