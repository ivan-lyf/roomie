import { Floorplan, type RawPlan, type Vec2 } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../../fixtures/plans/00-demo-1br/floorplan.json';
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
 * The demo plan as a vision model might read it off its image: every point up to 3 px off,
 * thicknesses a little off, the north wall in two pieces either side of a gap, half the rooms
 * traced along the inside of their walls, and the labels as loose text.
 */
function readDemo(seed = 7): RawPlan {
  const rand = random(seed);
  const jitter = (v: number, by = 3) => v + (rand() * 2 - 1) * by;
  const px = (p: Vec2) => ({ x: jitter(p.x / MPP), y: jitter(p.y / MPP) });
  const walls = truth.walls.flatMap((w) => {
    const thickness = jitter(w.thickness / MPP, 2);
    if (w.id !== 'w1') return [{ a: px(w.a), b: px(w.b), thickness }];
    return [
      { a: px(w.a), b: px(pointAlong(w, 2.98)), thickness },
      { a: px(pointAlong(w, 3.02)), b: px(w.b), thickness },
    ];
  });
  const openings = truth.openings.map((o) => {
    const wall = truth.walls.find((w) => w.id === o.wallId)!;
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
  const rooms = truth.rooms.map((r, i) => {
    const c = centroid(r.boundary);
    // Every other room along the inside faces of its walls, 6 px in.
    const inset = i % 2 === 0 ? 6 * MPP : 0;
    const polygon = r.boundary.map((p) =>
      px({ x: p.x + Math.sign(c.x - p.x) * inset, y: p.y + Math.sign(c.y - p.y) * inset }),
    );
    return { polygon };
  });
  return {
    walls,
    openings,
    rooms,
    obstacles: truth.obstacles.map((o) => ({ kind: o.kind, polygon: o.polygon.map(px) })),
    texts: truth.labels.map((l) => ({ text: l.text, bbox: l.bbox })),
  };
}

describe('reading the demo plan, from a noisy draft to meters', () => {
  const draft = tidyDraft(readDemo(), SIZE);
  const analysis = analyzeDraft(draft);

  it('finds the scale from the labels, in feet and inches, within 1%', () => {
    expect(analysis.scale.status).toBe('found');
    if (analysis.scale.status !== 'found') return;
    const { scale } = analysis.scale;
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
    if (analysis.scale.status !== 'found') throw new Error('no scale');
    const { scale } = analysis.scale;
    const read = { ...truth, ...convertDraft(draft, scale, truth.ceilingHeight, analysis), scale };
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

describe('reading under other noise', () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))('holds up with seed %i', (seed) => {
    const draft = tidyDraft(readDemo(seed), SIZE);
    const analysis = analyzeDraft(draft);
    if (analysis.scale.status !== 'found') throw new Error(`scale: ${analysis.scale.status}`);
    const { scale } = analysis.scale;
    expect(Math.abs(scale.metersPerPixel / MPP - 1)).toBeLessThan(0.01);
    const read = { ...truth, ...convertDraft(draft, scale, truth.ceilingHeight, analysis), scale };
    expect(validateFloorplan(read)).toEqual([]);
    const result = comparePlans(truth, read);
    expect(Math.min(result.walls.recall, result.walls.precision)).toBeGreaterThan(0.97);
    expect(result.doors.swingRight).toBe(4);
    expect(result.rooms.typed).toBe(6);
  });
});

describe('comparePlans', () => {
  it('scores a plan against itself as perfect', () => {
    expect(comparePlans(truth, truth)).toMatchObject({
      walls: { recall: 1, precision: 1 },
      openings: { recall: 1, precision: 1 },
      doors: { matched: 4, swingRight: 4 },
      rooms: { truth: 6, matched: 6, typed: 6, meanOverlap: 1 },
    });
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
  });
});
