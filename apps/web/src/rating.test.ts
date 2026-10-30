import type { Product } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { describeProduct, differences, FEATURES, tally, toggleItem } from './rating';

describe('differences', () => {
  it('lists the features both have that differ most, biggest first, leaving out small ones', () => {
    const a = {
      score: 0.8,
      breakdown: { walls: 1, tv_view: 0.9, spread: 0.5, windows: 1, focal: 0 },
    };
    const b = { score: 0.7, breakdown: { walls: 0.99, tv_view: 0.2, spread: 0.7, focal: 0.1 } };
    expect(differences(a, b)).toEqual([
      { feature: 'tv_view', a: 0.9, b: 0.2 },
      { feature: 'spread', a: 0.5, b: 0.7 },
      { feature: 'focal', a: 0, b: 0.1 },
    ]);
    expect(differences(a, b, 1)).toHaveLength(1);
    expect(differences(a, a)).toEqual([]);
  });

  it('has words for every feature the scorer weighs', async () => {
    const { default: weights } = await import('../../../packages/geometry/weights.json');
    expect(Object.keys(FEATURES).toSorted()).toEqual(Object.keys(weights.room).toSorted());
  });
});

describe('tally', () => {
  const summary = { rated: 0, decided: 0, scorerAgrees: 0, leftWins: 0, rooms: 49, roomsRated: 0 };
  it('says how the rating is going', () => {
    expect(tally(summary)).toBe('0 rated · 0 of 49 rooms rated');
    expect(
      tally({ ...summary, rated: 12, decided: 10, scorerAgrees: 7, leftWins: 6, roomsRated: 9 }),
    ).toBe(
      '12 rated · the scorer agrees on 7 of 10 with a winner · the left one won 6 of 10 · ' +
        '9 of 49 rooms rated',
    );
    const compare = {
      name: 'weights-fitted',
      rooms: 30,
      same: 8,
      rated: 20,
      wins: 12,
      losses: 6,
      ties: 2,
    };
    expect(tally({ ...summary, compare })).toBe(
      '0 rated · 0 of 49 rooms rated · blind check of weights-fitted: picked in 12, the current ' +
        'weights in 6, about the same in 2, of 20 rated; 8 of 30 rooms came out the same either way',
    );
  });
});

describe('toggleItem', () => {
  it('flags an item on one side, and unflags it', () => {
    const one = toggleItem([], 'a', 'f1');
    expect(one).toEqual([{ side: 'a', placementId: 'f1', note: '' }]);
    const both = toggleItem(one, 'b', 'f1');
    expect(both).toHaveLength(2);
    expect(toggleItem(both, 'a', 'f1')).toEqual([{ side: 'b', placementId: 'f1', note: '' }]);
  });
});

describe('describeProduct', () => {
  const product = {
    name: 'MALM Bed frame, high - white Queen',
    color: 'white',
    dims: { w: 1.66, d: 2.09, h: 1 },
    priceCad: 349,
  } as Product;
  it('names it with its size and price, and its color unless the name has it', () => {
    expect(describeProduct(product)).toBe(
      'MALM Bed frame, high - white Queen · 166 × 209 × 100 cm · $349.00',
    );
    expect(describeProduct({ ...product, color: 'oak veneer' })).toBe(
      'MALM Bed frame, high - white Queen · oak veneer · 166 × 209 × 100 cm · $349.00',
    );
  });
});
