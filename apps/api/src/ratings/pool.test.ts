import { randomUUID } from 'node:crypto';
import { Floorplan, LayoutIntent, Product } from '@roomie/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import intentJson from '../../../../fixtures/plans/00-demo-1br/intent.json';
import { products } from '../db/schema';
import { generateHome } from '../layouts/generate';
import type { IntentWriter } from '../layouts/intent';
import { logGeneration } from '../layouts/log';
import { testInputs } from '../layouts/test-homes';
import { testDb } from '../test/db';
import { nextSeed, testHomePlan } from './pool';

let db: Awaited<ReturnType<typeof testDb>>;
const plan = Floorplan.parse(demo);
const home = { name: '00-demo-1br', plan };
const items = Product.array().parse(catalog);

beforeEach(async () => {
  db = await testDb();
  await db.insert(products).values(items);
});

/** Answers from a cache, as the pool does: a repair not cached keeps the last answer. */
const writer = (model: string): IntentWriter => {
  const answer = {
    intent: LayoutIntent.parse(intentJson),
    problems: [],
    model,
    usage: { inputTokens: 0, outputTokens: 0 },
    durationMs: 1,
    messages: [],
  };
  return {
    model,
    promptVersion: 'layout-intent.v1',
    write: async () => answer,
    repair: async () => answer,
  };
};

describe('testHomePlan', () => {
  it('adds a test home once, as a test-set plan with no image, and finds it after', async () => {
    const first = await testHomePlan(db, home);
    expect(first?.added).toBe(true);
    expect(first?.plan).toMatchObject({ name: '00-demo-1br', source: 'test_set', image: null });
    expect(first?.plan.id).not.toBe(plan.id);
    expect(first?.plan.rooms).toEqual(plan.rooms);
    const again = await testHomePlan(db, home);
    expect(again).toEqual({ plan: first!.plan, added: false });
  });

  it("won't mix layouts of a plan read differently since", async () => {
    await testHomePlan(db, home);
    const moved = { ...plan, walls: plan.walls.map((w) => ({ ...w, thickness: 0.2 })) };
    expect(await testHomePlan(db, { ...home, plan: moved })).toBeUndefined();
  });
});

describe('nextSeed', () => {
  it("follows the seeds each model's furnishings of the home tried", async () => {
    const saved = (await testHomePlan(db, home))!.plan;
    expect(await nextSeed(db, saved.id, 'claude-haiku-5-5')).toBe(1);
    const inputs = testInputs(saved);
    const furnish = async (model: string, firstSeed?: number) => {
      const generation = await generateHome(saved, inputs, {
        writer: writer(model),
        catalog: items,
        seeds: 2,
        ...(firstSeed !== undefined && { firstSeed }),
      });
      await logGeneration(db, saved.id, randomUUID(), inputs, generation);
      return generation;
    };
    const first = await furnish('claude-haiku-5-5');
    expect(first.seeds).toEqual([1, 2]);
    expect(await nextSeed(db, saved.id, 'claude-haiku-5-5')).toBe(3);
    const more = await furnish('claude-haiku-5-5', 3);
    expect(more.seeds).toEqual([3, 4]);
    // Other seeds, other layouts.
    expect(more.candidates.map((c) => c.placements)).not.toEqual(
      first.candidates.map((c) => c.placements),
    );
    expect(await nextSeed(db, saved.id, 'claude-haiku-5-5')).toBe(5);
    expect(await nextSeed(db, saved.id, 'claude-opus-5-5')).toBe(1);
  });
});
