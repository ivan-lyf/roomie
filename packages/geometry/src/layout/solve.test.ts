import { Floorplan, LayoutIntent, Product } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import demoIntent from '../../../../fixtures/plans/00-demo-1br/intent.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import studioIntent from '../../../../fixtures/plans/01-demo-studio-metric/intent.json';
import studio from '../../../../fixtures/plans/01-demo-studio-metric/floorplan.json';
import { solveRoom } from './solve';
import { validateLayout } from './validate';

const products = new Map(
  Product.array()
    .parse(catalog)
    .map((p) => [p.articleNo, p]),
);

describe('solveRoom', () => {
  it.each([
    ['the demo one-bedroom', demo, demoIntent],
    ['the L-shaped studio', studio, studioIntent],
  ])('furnishes %s from its intent, valid and true to it', (_, planJson, intentJson) => {
    const plan = Floorplan.parse(planJson);
    const intent = LayoutIntent.parse(intentJson);
    const solved = intent.rooms.map((room) => solveRoom(plan, room, products, { seed: 1 }));
    for (const room of solved) {
      expect(room.unplaced).toEqual([]);
      expect(room.breakdown.relations).toBeGreaterThan(0.6);
      expect(room.score).toBeGreaterThan(0.6);
    }
    const furniture = solved.flatMap((r) => r.placements);
    expect(validateLayout(plan, furniture, products)).toEqual([]);
  });

  it('gives the same layout for the same seed', () => {
    const plan = Floorplan.parse(demo);
    const room = LayoutIntent.parse(demoIntent).rooms[1]!;
    const once = solveRoom(plan, room, products, { seed: 7, steps: 40 });
    expect(solveRoom(plan, room, products, { seed: 7, steps: 40 })).toEqual(once);
  });

  it('says which items have no spot, and why', () => {
    const plan = Floorplan.parse(demo);
    const queen = { articleNo: '900.000.10', why: '' };
    const room = {
      roomId: 'r1',
      items: ['a', 'b', 'c'].map((ref) => ({ ...queen, ref })),
      relations: [],
    };
    const solved = solveRoom(plan, room, products, { seed: 1, steps: 0 });
    expect(solved.placements.length).toBeGreaterThan(0);
    expect(solved.unplaced.at(-1)).toEqual({
      ref: 'c',
      reason: 'The 1.60 × 2.10 m bed has no spot left in the Bedroom once the rest is in.',
    });
    expect(validateLayout(plan, solved.placements, products)).toEqual([]);
  });
});
