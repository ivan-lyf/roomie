import { Floorplan, Product } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { candidatesText, pickCandidates, shortName, splitBudget } from './candidates';
import { compass, describeHome } from './describe';

const plan = Floorplan.parse(demo);
const products = Product.array().parse(catalog);

describe('describeHome', () => {
  it('names directions with north up the plan', () => {
    expect(
      [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: -1 },
      ].map(compass),
    ).toEqual(['north', 'east', 'south', 'north-west']);
  });

  it("tells what's along each wall of the rooms to furnish", () => {
    const text = describeHome(plan, ['r1', 'r2']);
    expect(text).toContain('Room r1: Bedroom (bedroom), 3.34 m east-west × 3.34 m north-south');
    expect(text).toContain(
      '- east wall, 3.34 m long (measured from its north end): door 0.80 m wide to Living at 2.40 m–3.20 m.',
    );
    expect(text).toContain('- south side, 4.34 m: no wall, open to Kitchen.');
    expect(text).toContain('Other rooms, left as they are: Kitchen (kitchen)');
  });
});

describe('pickCandidates', () => {
  const inputs = {
    roomIds: ['r1', 'r2'],
    budgetCad: 2500,
    style: 'scandinavian' as const,
    mustHaves: {},
  };

  it('splits the budget by room type and size', () => {
    const split = splitBudget(plan, inputs.roomIds, inputs.budgetCad);
    expect([...split.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(2500);
    expect(split.get('r2')!).toBeGreaterThan(split.get('r1')!);
  });

  it("offers what suits the rooms, fits them and keeps within each item's share", () => {
    const offered = pickCandidates(plan, products, inputs);
    expect(
      offered
        .get('bed')!
        .map((p) => p.articleNo)
        .sort(),
    ).toEqual(['900.000.10', '900.000.11']);
    expect(offered.has('dining_table')).toBe(false);
    expect(candidatesText(offered)).toContain(
      '- 900.000.15 | TEST Three-seat sofa | $899.00 | 220 × 90 × 85 cm | beige | Synthetic fibers',
    );
  });

  it('drops the size IKEA repeats in a name', () => {
    expect(shortName('TARVA Nightstand - pine 48x39x62 cm (18 7/8x15 3/8x24 3/8 ")')).toBe(
      'TARVA Nightstand - pine',
    );
  });
});
