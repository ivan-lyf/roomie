import { describe, expect, it } from 'vitest';
import catalog from '../../../fixtures/catalog/products.json';
import demoIntent from '../../../fixtures/plans/00-demo-1br/intent.json';
import demo from '../../../fixtures/plans/00-demo-1br/floorplan.json';
import studioIntent from '../../../fixtures/plans/01-demo-studio-metric/intent.json';
import studio from '../../../fixtures/plans/01-demo-studio-metric/floorplan.json';
import { FURNISHABLE, Floorplan, intentErrors, LayoutIntent, Product } from './index';

describe('fixtures/plans', () => {
  it.each([
    ['00-demo-1br', demo],
    ['01-demo-studio-metric', studio],
  ])('%s is a valid floorplan', (_, json) => {
    const plan = Floorplan.parse(json);
    const labels = new Set(plan.labels.map((t) => t.id));
    const walls = new Set(plan.walls.map((w) => w.id));
    for (const room of plan.rooms) {
      expect(room.furnishable).toBe(FURNISHABLE.has(room.roomType));
      for (const id of room.labelTextIds) expect(labels.has(id)).toBe(true);
    }
    for (const opening of plan.openings) expect(walls.has(opening.wallId)).toBe(true);
  });

  it.each([
    ['00-demo-1br', demo, demoIntent],
    ['01-demo-studio-metric', studio, studioIntent],
  ])('%s has a sound hand-written intent, from the made-up catalog', (_, json, intentJson) => {
    const plan = Floorplan.parse(json);
    const products = new Set(Product.array().parse(catalog).map((p) => p.articleNo));
    const furnishable = new Set(plan.rooms.filter((r) => r.furnishable).map((r) => r.id));
    expect(intentErrors(LayoutIntent.parse(intentJson), furnishable, products)).toEqual([]);
  });
});
