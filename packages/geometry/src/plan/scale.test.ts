import { describe, expect, it } from 'vitest';
import { Floorplan } from '@roomie/schema';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { rescalePlan } from './edit';
import {
  checkRoomLabels,
  detectScale,
  disagreeing,
  scaleFromArea,
  scaleFromAreaAndSide,
  scaleFromSamples,
  scaleFromWallLength,
} from './scale';

describe('scaleFromSamples', () => {
  it('fits exact labels with no residual', () => {
    const fit = scaleFromSamples([
      { meters: 3.5, pixels: 350 },
      { meters: 4.1, pixels: 410 },
    ]);
    expect(fit?.metersPerPixel).toBeCloseTo(0.01, 9);
    expect(fit?.residual).toBeCloseTo(0, 9);
  });

  it('is not thrown by one bad label, and flags it', () => {
    const samples = [
      { meters: 3.5, pixels: 350 },
      { meters: 4.1, pixels: 410 },
      { meters: 2.4, pixels: 240 },
      { meters: 9, pixels: 300 },
    ];
    const fit = scaleFromSamples(samples)!;
    expect(fit.metersPerPixel).toBeCloseTo(0.01, 9);
    expect(disagreeing(fit.metersPerPixel, samples)).toEqual([3]);
  });

  it('needs at least one usable length', () => {
    expect(scaleFromSamples([{ meters: 0, pixels: 10 }])).toBeUndefined();
  });
});

describe('detectScale', () => {
  // "3600 x 3000" on a room 360 x 300 px wide, with a door 85 px wide.
  const bare = (unit: 'metric_mm' | 'metric_cm' | 'metric_m', factor: number) => ({
    unit,
    samples: [
      { meters: 3600 * factor, pixels: 360 },
      { meters: 3000 * factor, pixels: 300 },
    ],
  });
  const evidence = {
    doorPixels: [85],
    rooms: [{ type: 'bedroom' as const, pixels: [360, 300] as const }],
  };

  it('picks the only unit that makes doors and rooms plausible', () => {
    const result = detectScale(
      [bare('metric_mm', 0.001), bare('metric_cm', 0.01), bare('metric_m', 1)],
      evidence,
    );
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.candidate.unit).toBe('metric_mm');
      expect(result.candidate.metersPerPixel).toBeCloseTo(0.01, 9);
    }
  });

  it('asks when no unit is plausible, most plausible first', () => {
    const result = detectScale([bare('metric_cm', 0.01), bare('metric_m', 1)], evidence);
    expect(result.status).toBe('ask');
    if (result.status === 'ask') {
      expect(result.candidates.map((c) => c.unit)).toEqual(['metric_cm', 'metric_m']);
    }
  });

  it('asks when more than one unit is plausible', () => {
    // With no doors or rooms to check against, both readings are plausible.
    const result = detectScale(
      [bare('metric_mm', 0.001), { unit: 'imperial', samples: [{ meters: 3.6, pixels: 360 }] }],
      { doorPixels: [], rooms: [] },
    );
    expect(result.status).toBe('ask');
  });

  it('finds nothing without labels', () => {
    expect(detectScale([], evidence)).toEqual({ status: 'none' });
  });
});

describe('calibration', () => {
  it('scales from one measured wall', () => {
    expect(scaleFromWallLength(366, 3.66)).toBeCloseTo(0.01, 9);
  });

  it('scales from an area the shape covers', () => {
    expect(scaleFromArea(520_000, 52)).toBeCloseTo(0.01, 9);
  });

  it('checks a measured side against the area', () => {
    const fine = scaleFromAreaAndSide({
      pixelArea: 520_000,
      squareMeters: 52,
      sidePixels: 800,
      sideMeters: 8,
      axis: 'x',
    });
    expect(fine.consistent).toBe(true);
    expect(fine.metersPerPixel).toBeCloseTo(0.01, 9);
  });

  it('spots a stretched image and solves for x and y apart', () => {
    // The image is squashed vertically: 1 px is 1 cm across but 1.2 cm down.
    const r = scaleFromAreaAndSide({
      pixelArea: 800 * 500,
      squareMeters: 8 * 6,
      sidePixels: 800,
      sideMeters: 8,
      axis: 'x',
    });
    expect(r.consistent).toBe(false);
    expect(r.stretched.x).toBeCloseTo(0.01, 9);
    expect(r.stretched.y).toBeCloseTo(0.012, 9);
  });
});

describe('checkRoomLabels', () => {
  const plan = Floorplan.parse(demo);

  it('agrees with the demo home', () => {
    const checks = checkRoomLabels(plan);
    expect(checks.map((c) => c.labelId)).toEqual(['t2', 't4', 't6']);
    expect(checks.every((c) => c.agrees)).toBe(true);
  });

  it('flags a label the room as drawn disagrees with', () => {
    const rooms = plan.rooms.map((r) =>
      r.id === 'r1' ? { ...r, boundary: r.boundary.map((p) => ({ x: p.x * 1.1, y: p.y })) } : r,
    );
    const bad = checkRoomLabels({ ...plan, rooms }).filter((c) => !c.agrees);
    expect(bad.map((c) => c.labelId)).toEqual(['t2']);
    expect(bad[0]!.error).toBeGreaterThan(0.03);
  });

  it('leaves ceiling labels out: their length is a height', () => {
    const ceiling = {
      id: 'c1',
      text: "8' CLG",
      bbox: { x: 180, y: 240, w: 60, h: 16 },
      kind: 'ceiling' as const,
      parsed: { meters: [2.4384] },
    };
    const rooms = plan.rooms.map((r) =>
      r.id === 'r1' ? { ...r, labelTextIds: [...r.labelTextIds, 'c1'] } : r,
    );
    const checks = checkRoomLabels({ ...plan, rooms, labels: [...plan.labels, ceiling] });
    expect(checks.map((c) => c.labelId)).toEqual(['t2', 't4', 't6']);
  });

  it('flags labels once the scale is 7% off', () => {
    const checks = checkRoomLabels(rescalePlan(plan, 1.07));
    expect(checks.some((c) => !c.agrees)).toBe(true);
    expect(Math.min(...checks.map((c) => c.error))).toBeGreaterThan(0.015);
  });
});
