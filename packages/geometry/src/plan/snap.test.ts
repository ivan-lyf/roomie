import { describe, expect, it } from 'vitest';
import { closestOnSegment, snapPoint } from './snap';

const wall = { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } };

describe('snapPoint', () => {
  it('snaps to a nearby point before anything else', () => {
    const targets = { points: [wall.b], segments: [wall], tolerance: 0.1 };
    const snap = snapPoint({ x: 4.05, y: 0.04 }, targets);
    expect(snap).toEqual({ point: { x: 4, y: 0 }, to: 'point' });
  });

  it('lands on a nearby wall', () => {
    const snap = snapPoint({ x: 2, y: 0.08 }, { points: [], segments: [wall], tolerance: 0.1 });
    expect(snap).toEqual({ point: { x: 2, y: 0 }, to: 'segment' });
  });

  it('keeps a drawn wall level or plumb', () => {
    const from = { x: 1, y: 1 };
    const snap = snapPoint({ x: 3, y: 1.07 }, { points: [], segments: [], from, tolerance: 0.1 });
    expect(snap.to).toBe('angle');
    expect(snap.point.x).toBeCloseTo(3, 2);
    expect(snap.point.y).toBeCloseTo(1, 9);
  });

  it('meets a wall square on, where the angle line crosses it', () => {
    const from = { x: 2.03, y: 3 };
    const targets = { points: [], segments: [wall], from, tolerance: 0.1 };
    const snap = snapPoint({ x: 1.98, y: 0.06 }, targets);
    expect(snap.to).toBe('angle_segment');
    expect(snap.point.x).toBeCloseTo(2.03, 9);
    expect(snap.point.y).toBeCloseTo(0, 9);
  });

  it('leaves points alone with nothing near', () => {
    const p = { x: 2, y: 2 };
    expect(snapPoint(p, { points: [wall.a], segments: [wall], tolerance: 0.1 })).toEqual({
      point: p,
      to: 'none',
    });
  });
});

describe('closestOnSegment', () => {
  it('stays within the segment', () => {
    expect(closestOnSegment({ x: -1, y: 1 }, wall)).toEqual({ point: { x: 0, y: 0 }, t: 0 });
    expect(closestOnSegment({ x: 1, y: 1 }, wall)).toEqual({ point: { x: 1, y: 0 }, t: 0.25 });
  });
});
