import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoPlan, demoRawPlan } from '../test/fixtures';
import { type EvalPlan, evalPlan, formatReport, ReadingCache } from './eval';
import type { PlanReader } from './reader';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'roomie-eval-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const plan: EvalPlan = {
  name: '00-demo-1br',
  image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', width: 900, height: 750 },
  truth: demoPlan,
  units: 'imperial',
};

/** A reader that reads the demo perfectly, counting its reads. */
function perfectReader() {
  const reader: PlanReader & { reads: number } = {
    provider: 'fake',
    model: 'fake-1',
    promptVersion: 'plan-read.v1',
    reads: 0,
    planFromRaw: () => demoRawPlan(),
    async read() {
      reader.reads++;
      return { raw: { cached: 'answer' }, plan: demoRawPlan(), durationMs: 1500 };
    },
  };
  return reader;
}

describe('evalPlan', () => {
  it('measures a reading against the true plan', async () => {
    const result = await evalPlan(plan, perfectReader());
    expect(result.scale).toMatchObject({
      status: 'found',
      unit: 'imperial',
      expectedUnit: 'imperial',
    });
    expect(Math.abs(result.scale.error!)).toBeLessThan(0.01);
    expect(result.geometry).toMatchObject({
      walls: { recall: 1, precision: 1 },
      openings: { recall: 1, precision: 1 },
      doors: { matched: 4, swingRight: 4 },
      rooms: { truth: 6, typed: 6 },
    });
    expect(result.problems).toEqual([]);
  });

  it('reads each image once per model and prompt, unless asked to read afresh', async () => {
    const reader = perfectReader();
    const cache = new ReadingCache(dir);
    expect((await evalPlan(plan, reader, cache)).cached).toBe(false);
    expect((await evalPlan(plan, reader, cache)).cached).toBe(true);
    expect(reader.reads).toBe(1);
    expect((await evalPlan(plan, reader, cache, { fresh: true })).cached).toBe(false);
    expect(reader.reads).toBe(2);
  });
});

describe('formatReport', () => {
  it('reports each plan, with totals against the goals', async () => {
    const report = formatReport([await evalPlan(plan, perfectReader())]);
    expect(report).toMatch(/00-demo-1br\s+2 s\s+imperial [+-]0\.\d%\s+100%\/100%/);
    expect(report).toMatch(/Room types right: 6\/6 \(goal ≥ 90%\)\. Scale within 3%: 1\/1 plans/);
  });
});
