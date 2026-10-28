import { Floorplan, type RawPlan, type Vec2 } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../../fixtures/plans/00-demo-1br/floorplan.json';
import studio from '../../../../../fixtures/plans/01-demo-studio-metric/floorplan.json';
import { centroid } from '../polygon';
import { validateFloorplan } from '../validate';
import { doorSwing, pointAlong } from '../walls';
import { analyzeDraft } from './analyze';
import { comparePlans, overlap } from './compare';
import { convertDraft } from './convert';
import { tidyDraft } from './tidy';

const truth = Floorplan.parse(demo);
const MPP = truth.scale!.metersPerPixel;
const SIZE = { width: 900, height: 750 };
const metric = Floorplan.parse(studio);

/** A seeded random number generator (mulberry32), so the noise is the same every run. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A plan as a vision model might read it off its image: every point up to 3 px off, thicknesses
 * a little off, the first wall in two pieces either side of a gap, every other room traced along
 * the inside faces of its walls, and the labels as loose text.
 */
function readPlan(plan: Floorplan, seed = 7): RawPlan {
  const mpp = plan.scale!.metersPerPixel;
  const rand = random(seed);
  const jitter = (v: number, by = 3) => v + (rand() * 2 - 1) * by;
  const px = (p: Vec2) => ({ x: jitter(p.x / mpp), y: jitter(p.y / mpp) });
  const walls = plan.walls.flatMap((w) => {
    const thickness = jitter(w.thickness / mpp, 2);
    if (w.id !== 'w1') return [{ a: px(w.a), b: px(w.b), thickness }];
    return [
      { a: px(w.a), b: px(pointAlong(w, 2.98)), thickness },
      { a: px(pointAlong(w, 3.02)), b: px(w.b), thickness },
    ];
  });
  const openings = plan.openings.map((o) => {
    const wall = plan.walls.find((w) => w.id === o.wallId)!;
    const swing = doorSwing(wall, o);
    return {
      kind: o.kind,
      a: px(pointAlong(wall, o.offset)),
      b: px(pointAlong(wall, o.offset + o.width)),
      ...(swing && {
        swing: {
          hinge: px(swing.hinge),
          toward: px({
            x: swing.hinge.x + swing.open.x * swing.radius * 0.9,
            y: swing.hinge.y + swing.open.y * swing.radius * 0.9,
          }),
        },
      }),
    };
  });
  const rooms = plan.rooms.map((r, i) => {
    const c = centroid(r.boundary);
    const inset = i % 2 === 0 ? 6 * mpp : 0;
    const polygon = r.boundary.map((p) =>
      px({ x: p.x + Math.sign(c.x - p.x) * inset, y: p.y + Math.sign(c.y - p.y) * inset }),
    );
    return { polygon };
  });
  return {
    walls,
    openings,
    rooms,
    obstacles: plan.obstacles.map((o) => ({ kind: o.kind, polygon: o.polygon.map(px) })),
    texts: plan.labels.map((l) => ({ text: l.text, bbox: l.bbox })),
  };
}

/** Reads a plan through the whole pipeline, as the app would. */
function pipeline(plan: Floorplan, size: { width: number; height: number }, seed = 7) {
  const draft = tidyDraft(readPlan(plan, seed), size);
  const analysis = analyzeDraft(draft);
  if (analysis.scale.status !== 'found') throw new Error(`scale: ${analysis.scale.status}`);
  const { scale } = analysis.scale;
  const ceiling = analysis.ceiling ?? plan.ceilingHeight;
  const read = { ...plan, ...convertDraft(draft, scale, ceiling, analysis), scale };
  return { draft, analysis, scale, read };
}

describe('reading the demo plan, from a noisy draft to meters', () => {
  const { analysis, scale, read } = pipeline(truth, SIZE);

  it('finds the scale from the labels, in feet and inches, within 1%', () => {
    expect(scale).toMatchObject({ sourceUnit: 'imperial', method: 'labels' });
    expect(scale.inputs).toMatchObject({ convention: 'center' });
    expect(Math.abs(scale.metersPerPixel / MPP - 1)).toBeLessThan(0.01);
  });

  it('types and names every room from its labels', () => {
    const rooms = [...analysis.rooms.values()];
    expect(rooms.map((r) => [r.name, r.type])).toEqual([
      ['Bedroom', 'bedroom'],
      ['Living', 'living_room'],
      ['Kitchen', 'kitchen'],
      ['Bathroom', 'bathroom'],
      ['Closet', 'closet'],
      ['Foyer', 'hallway'],
    ]);
  });

  it('converts to a sound plan close to the real one', () => {
    expect(validateFloorplan(read)).toEqual([]);
    const result = comparePlans(truth, read);
    expect(result.walls.recall).toBeGreaterThan(0.97);
    expect(result.walls.precision).toBeGreaterThan(0.97);
    expect(result.openings).toMatchObject({ recall: 1, precision: 1 });
    expect(result.doors).toEqual({ matched: 4, swingRight: 4 });
    expect(result.rooms).toMatchObject({ truth: 6, matched: 6, typed: 6 });
    expect(result.rooms.meanOverlap).toBeGreaterThan(0.95);
    // Labels keep their pixel boxes, with lengths read in feet.
    expect(read.labels.find((l) => l.id === 't2')?.parsed?.meters?.[0]).toBeCloseTo(3.5052, 6);
  });
});

describe('reading a metric studio labelled in French, sized inside its walls', () => {
  const { analysis, scale, read } = pipeline(metric, { width: 875, height: 825 });

  it('works out the labels are bare meters, measured inside the walls', () => {
    expect(scale).toMatchObject({ sourceUnit: 'metric_m', inputs: { convention: 'inside' } });
    expect(Math.abs(scale.metersPerPixel / 0.008 - 1)).toBeLessThan(0.015);
  });

  it('reads the rooms and the ceiling height', () => {
    expect([...analysis.rooms.values()].map((r) => [r.name, r.type])).toEqual([
      ['Studio', 'studio'],
      ['Salle de bain', 'bathroom'],
    ]);
    expect(analysis.ceiling).toBe(2.5);
    // Windows end 30 cm under the plan's 2.5 m ceiling.
    expect(read.openings.find((o) => o.kind === 'window')?.height).toBeCloseTo(1.3, 9);
  });

  it('converts to a sound plan close to the real one', () => {
    expect(validateFloorplan(read)).toEqual([]);
    const result = comparePlans(metric, read);
    expect(Math.min(result.walls.recall, result.walls.precision)).toBeGreaterThan(0.97);
    expect(result.openings).toMatchObject({ recall: 1, precision: 1 });
    expect(result.doors).toEqual({ matched: 2, swingRight: 2 });
    expect(result.rooms).toMatchObject({ truth: 2, matched: 2, typed: 2 });
  });
});

describe('room labels on two lines', () => {
  it('reads "MASTER" over "BATH" as a bathroom', () => {
    const P = (x: number, y: number) => ({ x, y });
    const analysis = analyzeDraft({
      walls: [],
      openings: [],
      rooms: [{ id: 'r1', polygon: [P(0, 0), P(300, 0), P(300, 200), P(0, 200)] }],
      obstacles: [],
      texts: [
        { id: 't1', text: 'MASTER', bbox: { x: 100, y: 80, w: 80, h: 16 } },
        { id: 't2', text: 'BATH', bbox: { x: 110, y: 100, w: 60, h: 16 } },
      ],
    });
    expect(analysis.rooms.get('r1')).toMatchObject({ type: 'bathroom', name: 'Bathroom' });
  });
});

describe('overall sizes and mixed labels', () => {
  const P = (x: number, y: number) => ({ x, y });
  const box = (x0: number, y0: number, x1: number, y1: number) => [
    P(x0, y0),
    P(x1, y0),
    P(x1, y1),
    P(x0, y1),
  ];
  // A 500 x 400 px house with 20 px walls: 520 x 420 px to the outer faces.
  const walls = box(100, 100, 600, 500).map((a, i, all) => ({
    id: `w${i + 1}`,
    a,
    b: all[(i + 1) % 4]!,
    thickness: 20,
  }));
  const text = (id: string, value: string, x: number, y: number) => ({
    id,
    text: value,
    bbox: { x, y, w: 60, h: 16 },
  });

  it("takes the scale from the building's overall sizes beside it", () => {
    const analysis = analyzeDraft({
      walls,
      openings: [{ id: 'o1', wallId: 'w1', kind: 'door', offset: 100, width: 40 }],
      rooms: [{ id: 'r1', polygon: box(100, 100, 600, 500) }],
      obstacles: [],
      texts: [
        // "1 040" cm across the top, and "840" down the right: 0.02 m a pixel both ways.
        text('t1', '1 040', 320, 40),
        text('t2', '840', 640, 290),
        // A part of the width, also above: the longest is the whole.
        text('t3', '500', 150, 40),
        // A room area that disagrees: the overall sizes win.
        text('t4', 'SEJOUR', 320, 280),
        text('t5', '120 m²', 320, 300),
      ],
    });
    expect(analysis.scale.status).toBe('found');
    if (analysis.scale.status !== 'found') return;
    expect(analysis.scale.scale).toMatchObject({
      sourceUnit: 'metric_cm',
      inputs: { convention: 'overall', labelIds: ['t1', 't2'] },
    });
    expect(analysis.scale.scale.metersPerPixel).toBeCloseTo(0.02, 9);
  });

  it("settles a room holding two rooms' labels by what the reader said it is", () => {
    const draft = (type?: 'hallway') => ({
      walls,
      openings: [],
      rooms: [{ id: 'r1', polygon: box(100, 100, 600, 500), ...(type && { type }) }],
      obstacles: [],
      texts: [text('t1', 'WC', 200, 200), text('t2', 'HALL', 300, 300)],
    });
    expect(analyzeDraft(draft('hallway')).rooms.get('r1')).toMatchObject({ type: 'hallway' });
    expect(analyzeDraft(draft()).rooms.get('r1')).toMatchObject({ type: 'bathroom' });
  });
});

describe('an open plan read as one room', () => {
  it("leaves out the room's two sizes, and scales from the others", () => {
    // The living room and kitchen as one polygon, holding both their labels.
    const raw = readPlan(truth);
    const [living, kitchen] = [raw.rooms[1]!, raw.rooms[2]!];
    raw.rooms.splice(1, 2, {
      polygon: [living.polygon[0]!, living.polygon[1]!, kitchen.polygon[2]!, kitchen.polygon[3]!],
    });
    const analysis = analyzeDraft(tidyDraft(raw, SIZE));
    if (analysis.scale.status !== 'found') throw new Error(`scale: ${analysis.scale.status}`);
    expect(analysis.scale.scale.inputs).toMatchObject({ labelIds: ['t2'] });
    // One square room can't tell sizes to the walls' centers from sizes inside them, so the
    // scale is only good to a wall's thickness.
    expect(Math.abs(analysis.scale.scale.metersPerPixel / MPP - 1)).toBeLessThan(0.05);
    expect([...analysis.rooms.values()][1]).toMatchObject({ name: 'Living', type: 'living_room' });
  });
});

describe('reading under other noise', () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))('holds up with seed %i', (seed) => {
    for (const [plan, size] of [
      [truth, SIZE],
      [metric, { width: 875, height: 825 }],
    ] as const) {
      const { scale, read } = pipeline(plan, size, seed);
      expect(Math.abs(scale.metersPerPixel / plan.scale!.metersPerPixel - 1)).toBeLessThan(0.02);
      expect(validateFloorplan(read)).toEqual([]);
      const result = comparePlans(plan, read);
      expect(Math.min(result.walls.recall, result.walls.precision)).toBeGreaterThan(0.95);
      expect(result.doors.swingRight).toBe(result.doors.matched);
      expect(result.rooms.typed).toBe(plan.rooms.length);
    }
  });
});

describe('comparePlans', () => {
  it('scores a plan against itself as perfect', () => {
    const result = comparePlans(truth, truth);
    expect(result).toMatchObject({
      walls: { recall: 1, precision: 1 },
      openings: { recall: 1, precision: 1 },
      doors: { matched: 4, swingRight: 4 },
      rooms: { truth: 6, matched: 6, typed: 6 },
    });
    expect(result.rooms.meanOverlap).toBeCloseTo(1, 9);
  });

  it('misses walls moved too far, and rooms of the wrong type', () => {
    const moved = {
      ...truth,
      walls: truth.walls.map((w) =>
        w.id === 'w1' ? { ...w, a: { ...w.a, y: 0.8 }, b: { ...w.b, y: 0.8 } } : w,
      ),
      rooms: truth.rooms.map((r) =>
        r.id === 'r1' ? { ...r, roomType: 'den_office' as const } : r,
      ),
    };
    const result = comparePlans(truth, moved);
    expect(result.walls.recall).toBeLessThan(0.85);
    expect(result.rooms.typed).toBe(5);
  });

  it('measures overlap', () => {
    const square = (x: number) => [
      { x, y: 0 },
      { x: x + 1, y: 0 },
      { x: x + 1, y: 1 },
      { x, y: 1 },
    ];
    expect(overlap(square(0), square(0))).toBe(1);
    expect(overlap(square(0), square(0.5))).toBeCloseTo(1 / 3, 2);
    expect(overlap(square(0), square(2))).toBe(0);
    expect(overlap(square(0), square(1))).toBe(0);
  });
});

describe('wall thickness', () => {
  const P = (x: number, y: number) => ({ x, y });
  const wall = (id: string, a: Vec2, b: Vec2, thickness: number) => ({ id, a, b, thickness });
  /** Two rooms side by side at 1 cm a pixel, every wall read `t` px thick. */
  const draft = (t: number, inside = t) => ({
    walls: [
      wall('w1', P(0, 0), P(800, 0), t),
      wall('w2', P(800, 0), P(800, 400), t),
      wall('w3', P(800, 400), P(0, 400), t),
      wall('w4', P(0, 400), P(0, 0), t),
      wall('w5', P(400, 0), P(400, 400), inside),
    ],
    openings: [],
    rooms: [
      { id: 'r1', polygon: [P(0, 0), P(400, 0), P(400, 400), P(0, 400)], label: 'BEDROOM' },
      { id: 'r2', polygon: [P(400, 0), P(800, 0), P(800, 400), P(400, 400)], label: 'LIVING' },
    ],
    obstacles: [],
    texts: [],
  });
  const thicknesses = (d: ReturnType<typeof draft>) =>
    convertDraft(d, { metersPerPixel: 0.01, sourceUnit: 'metric_cm' }, 2.5).walls.map(
      (w) => +w.thickness.toFixed(3),
    );

  it('makes an inside wall read too thick 12 cm, and keeps outside walls within 35 cm', () => {
    expect(thicknesses(draft(40))).toEqual([0.35, 0.35, 0.35, 0.35, 0.12]);
  });

  it('keeps an inside wall read thin enough, and thickens a thin outside wall', () => {
    expect(thicknesses(draft(10, 9))).toEqual([0.15, 0.15, 0.15, 0.15, 0.09]);
    expect(thicknesses(draft(25, 14))).toEqual([0.25, 0.25, 0.25, 0.25, 0.14]);
  });
});

describe('a plan with only area labels', () => {
  /** The two-room draft below, with the areas printed in each room. */
  const read = (first: string, second: string) => analyzeDraft(twoRooms(first, second)).scale;

  it('measures the areas inside the walls', () => {
    const scale = read('9.99 m²', '12.69 m²');
    expect(scale.status).toBe('found');
    if (scale.status === 'found') {
      expect(scale.scale.metersPerPixel).toBeCloseTo(0.01, 4);
      expect(scale.scale.inputs).toMatchObject({ convention: 'inside' });
    }
  });

  it('keeps to the inside even when the center lines fit the areas a little better', () => {
    // 12 and 15 m² are the rooms center to center; inside the walls, they'd be 1.09 cm a pixel.
    const scale = read('12.00 m²', '15.00 m²');
    expect(scale.status).toBe('found');
    if (scale.status === 'found') {
      expect(scale.scale.metersPerPixel).toBeCloseTo(0.0109, 4);
      expect(scale.scale.inputs).toMatchObject({ convention: 'inside' });
    }
  });

  function twoRooms(first: string, second: string) {
    const P = (x: number, y: number) => ({ x, y });
    // At 1 cm a pixel, two rooms 400 × 300 and 500 × 300 px on 30 px walls' center lines: inside
    // the walls, 3.7 × 2.7 m and 4.7 × 2.7 m.
    const wall = (id: string, a: Vec2, b: Vec2) => ({ id, a, b, thickness: 30 });
    const box = (x0: number, x1: number) => [P(x0, 0), P(x1, 0), P(x1, 300), P(x0, 300)];
    const label = (id: string, text: string, x: number, y: number) => ({
      id,
      text,
      bbox: { x, y, w: 80, h: 20 },
    });
    const draft = {
      walls: [
        wall('w1', P(0, 0), P(900, 0)),
        wall('w2', P(900, 0), P(900, 300)),
        wall('w3', P(900, 300), P(0, 300)),
        wall('w4', P(0, 300), P(0, 0)),
        wall('w5', P(400, 0), P(400, 300)),
      ],
      openings: [],
      rooms: [
        { id: 'r1', polygon: box(0, 400), label: 'CHAMBRE' },
        { id: 'r2', polygon: box(400, 900), label: 'SEJOUR' },
      ],
      obstacles: [],
      texts: [
        label('t1', 'CHAMBRE', 150, 100),
        label('t2', first, 150, 150),
        label('t3', 'SEJOUR', 600, 100),
        label('t4', second, 600, 150),
      ],
    };
    return draft;
  }
});
