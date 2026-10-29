import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Floorplan, LayoutIntent, Product } from '@roomie/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import intentJson from '../../../../fixtures/plans/00-demo-1br/intent.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { pickCandidates } from './candidates';
import { contactSheet, formatLayoutReport, type HomeResult, homeSvg, IntentCache } from './eval';
import type { IntentResult, IntentWriter } from './intent';

const plan = Floorplan.parse(demo);
const products = Product.array().parse(catalog);
const inputs = {
  roomIds: ['r1', 'r2'],
  budgetCad: 3000,
  style: 'scandinavian' as const,
  mustHaves: {},
};
const request = { plan, inputs, candidates: pickCandidates(plan, products, inputs) };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'roomie-intents-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('IntentCache', () => {
  it('asks once per request, and answers from the cache after', async () => {
    let calls = 0;
    const answer: IntentResult = {
      intent: LayoutIntent.parse(intentJson),
      problems: [],
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
      messages: [],
    };
    const writer: IntentWriter = {
      model: 'm',
      promptVersion: 'v1',
      write: async () => (calls++, answer),
      repair: async () => (calls++, answer),
    };
    const cache = new IntentCache(dir);
    expect(await cache.has(cache.firstKey(writer, request))).toBe(false);
    const cached = cache.wrap(writer);
    await cached.write(request);
    expect(await new IntentCache(dir).wrap(writer).write(request)).toEqual(answer);
    expect(calls).toBe(1);
    expect(cache.fresh).toHaveLength(1);
    await cached.repair(answer, request, 'too big');
    await cached.repair(answer, request, 'too big');
    expect(calls).toBe(2);

    // Offline, nothing is asked: a new repair keeps the last answer.
    const offline = cache.wrap(writer, { offline: true });
    expect(await offline.repair(answer, request, 'too wide')).toMatchObject({
      intent: answer.intent,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect([calls, cache.skipped]).toEqual([2, 1]);
    const other = { ...request, inputs: { ...inputs, budgetCad: 1 } };
    await expect(offline.write(other)).rejects.toThrow(/No cached intent/);
  });
});

describe('the report', () => {
  const home: HomeResult = {
    name: '00-demo-1br',
    rooms: 2,
    items: 1,
    problems: 0,
    score: 0.9,
    repairs: 0,
    leftOut: [],
    intentSeconds: 20,
    solveSeconds: 1.2,
    costUsd: 0.09,
    cached: false,
    svg: homeSvg(
      plan,
      [{ id: 'f1', articleNo: '900.000.15', roomId: 'r2', x: 4.51, y: 1.8, rotation: Math.PI / 2 }],
      new Map(products.map((p) => [p.articleNo, p])),
    ),
  };

  it('draws the home from above, each item labelled', () => {
    expect(home.svg).toMatch(/^<svg/);
    expect(home.svg).toContain('>sofa</text>');
  });

  it('tallies validity, score, time and spend', () => {
    const report = formatLayoutReport([home, { ...home, name: 'b', problems: 2, cached: true }]);
    expect(report).toContain('Valid: 1/2 (goal 100%). Mean score 0.90. Slowest home 21 s');
    expect(report).toContain('Spent on intents this run: $0.09.');
    expect(contactSheet([home], 'Test')).toContain("I'd live with this");
  });
});
