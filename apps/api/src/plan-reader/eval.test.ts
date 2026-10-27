import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoPlan, demoRawPlan } from '../test/fixtures';
import type { PlanDraft } from '@roomie/schema';
import {
  type EvalPlan,
  evalPlan,
  formatReport,
  LabelTruth,
  ReadingCache,
  scoreFit,
} from './eval';
import type { PlanReader } from './reader';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'roomie-eval-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const image = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png' as const,
  width: 900,
  height: 750,
};
const plan: EvalPlan = { name: '00-demo-1br', image, floorplan: demoPlan, units: 'imperial' };

/** The demo as a plan from elsewhere would be known: its scale, and its rooms by label. */
const labelled: EvalPlan = {
  name: 'demo-by-label',
  image,
  units: 'imperial',
  labels: LabelTruth.parse({
    metersPerPixel: 0.01,
    scaleSource: 'drawn at 1 px = 1 cm',
    rooms: [
      { label: 'BEDROOM', type: 'bedroom', squareMeters: 3.4 * 3.4 },
      { label: 'LIVING', type: 'living_room' },
      { label: 'KITCHEN', type: 'kitchen' },
      { label: 'BATH', type: 'bathroom', squareMeters: 40 },
      { label: 'CL', type: 'closet' },
      { label: 'FOYER', type: 'hallway' },
      { label: 'PANTRY', type: 'closet' },
    ],
  }),
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

describe('evalPlan, for a plan known by its labels', () => {
  it('finds rooms by their labels, checks their types and printed areas', async () => {
    const result = await evalPlan(labelled, perfectReader());
    expect(result.geometry).toBeUndefined();
    // Every room but the pantry the truth made up; the bath's 40 m² is wrong on purpose.
    expect(result.rooms).toMatchObject({
      named: 7,
      found: 6,
      typed: 6,
      areas: { checked: 2, within: 1 },
    });
    expect(result.rooms.areas!.rooms.map((r) => r.label)).toEqual(['BEDROOM', 'BATH']);
    expect(result.rooms.areas!.rooms[0]!.read).toBeCloseTo(3.4 * 3.4, 0);
    expect(Math.abs(result.scale.error!)).toBeLessThan(0.01);
    expect(result.problems).toEqual([]);
  });
});

describe('scoreFit', () => {
  const P = (x: number, y: number) => ({ x, y });
  const box = (x0: number, y0: number, x1: number, y1: number) => [
    P(x0, y0),
    P(x1, y0),
    P(x1, y1),
    P(x0, y1),
  ];
  const wall = (id: string, a: { x: number; y: number }, b: { x: number; y: number }) => ({
    id,
    a,
    b,
    thickness: 10,
  });
  const draft: PlanDraft = {
    walls: [
      wall('w1', P(0, 0), P(800, 0)),
      wall('w2', P(800, 0), P(800, 400)),
      wall('w3', P(800, 400), P(0, 400)),
      wall('w4', P(0, 400), P(0, 0)),
      wall('w5', P(400, 0), P(400, 400)),
    ],
    openings: [],
    rooms: [
      // The hall is drawn 100 px too far right, past the wall between, and off its label.
      { id: 'r1', polygon: box(0, 0, 500, 400), label: 'BEDROOM' },
      { id: 'r2', polygon: box(500, 0, 800, 400), label: 'HALL' },
    ],
    obstacles: [],
    texts: [
      { id: 't1', text: 'BEDROOM', bbox: { x: 150, y: 190, w: 80, h: 20 } },
      { id: 't2', text: 'HALL', bbox: { x: 430, y: 190, w: 40, h: 20 } },
    ],
  };

  it('counts labels outside their room, and edges between rooms with no wall', () => {
    const fit = scoreFit(draft, 0.01);
    expect(fit).toMatchObject({ labelled: 2, labelsOutside: 1 });
    // The edge between them, 1 m off the wall; near the corners the outside walls are close.
    expect(fit.edgesWithoutWall).toBeGreaterThan(0.7);
  });

  it('finds a wall under every edge between rooms when they follow the walls', () => {
    const fitted = {
      ...draft,
      rooms: [
        { id: 'r1', polygon: box(0, 0, 400, 400), label: 'BEDROOM' },
        { id: 'r2', polygon: box(400, 0, 800, 400), label: 'HALL' },
      ],
    };
    expect(scoreFit(fitted, 0.01)).toEqual({ labelled: 2, labelsOutside: 0, edgesWithoutWall: 0 });
    expect(scoreFit(fitted, undefined)).toEqual({ labelled: 2, labelsOutside: 0 });
  });
});

describe('formatReport', () => {
  it('reports each plan, with totals against the goals', async () => {
    const report = formatReport([
      await evalPlan(plan, perfectReader()),
      await evalPlan(labelled, perfectReader()),
    ]);
    expect(report).toMatch(/00-demo-1br\s+2 s\s+imperial [+-]0\.\d%\s+100%\/100%/);
    expect(report).toMatch(/demo-by-label .*–\s+–\s+–\s+6\/7\s+6\/7\s+1\/2/);
    expect(report).toMatch(/Room types right: 12\/13 \(92%, goal ≥ 90%\)/);
    expect(report).toMatch(/Scale within 3%: 2\/2/);
    expect(report).toMatch(/Areas within 15%: 1\/2\. Labels outside their room: 0\//);
  });
});
