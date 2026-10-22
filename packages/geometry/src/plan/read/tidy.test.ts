import type { RawPlan } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { tidyDraft } from './tidy';

const size = { width: 1000, height: 800 };
const P = (x: number, y: number) => ({ x, y });

/**
 * A two-room plan as a reader might return it: corners a little off, the top wall broken where
 * its window is, the middle wall stopping short of the outside walls, the rooms traced along
 * the inside faces of the walls.
 */
const raw: RawPlan = {
  walls: [
    { a: P(102, 99), b: P(380, 101), thickness: 20 },
    { a: P(470, 100), b: P(897, 98), thickness: 22 },
    { a: P(901, 103), b: P(899, 702), thickness: 20 },
    { a: P(896, 700), b: P(104, 701), thickness: 20 },
    { a: P(100, 697), b: P(99, 104), thickness: 18 },
    { a: P(501, 112), b: P(499, 690), thickness: 12 },
  ],
  openings: [
    { kind: 'window', a: P(380, 100), b: P(470, 100) },
    {
      kind: 'door',
      a: P(500, 400),
      b: P(500, 480),
      swing: { hinge: P(500, 400), toward: P(430, 402) },
    },
    { kind: 'door', a: P(300, 300), b: P(380, 300) },
  ],
  rooms: [
    { polygon: [P(110, 110), P(494, 110), P(494, 690), P(110, 690)], label: 'BEDROOM' },
    { polygon: [P(506, 110), P(890, 110), P(890, 690), P(506, 690)], type: 'living_room' },
  ],
  obstacles: [{ kind: 'counter', polygon: [P(700, 640), P(889, 641), P(889, 689), P(700, 690)] }],
  texts: [
    { text: ' BEDROOM ', bbox: { x: 250, y: 380, w: 90, h: 20 } },
    { text: '', bbox: { x: 0, y: 0, w: 1, h: 1 } },
  ],
};

describe('tidyDraft', () => {
  const draft = tidyDraft(raw, size);
  const wallAt = (x: number, y: number) =>
    draft.walls.find((w) => {
      const [x0, x1] = [Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)];
      const [y0, y1] = [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)];
      return x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1;
    });

  it('joins a wall broken at its window, and meets walls at their corners', () => {
    expect(draft.walls).toHaveLength(5);
    const corners = draft.walls.flatMap((w) => [w.a, w.b]);
    for (const corner of [P(100.5, 100), P(900, 100), P(900, 700.5), P(100.5, 700.5)]) {
      expect(corners.some((c) => Math.hypot(c.x - corner.x, c.y - corner.y) < 1.5)).toBe(true);
    }
    // Level and plumb exactly.
    for (const w of draft.walls) expect(w.a.x === w.b.x || w.a.y === w.b.y).toBe(true);
  });

  it('runs the middle wall on to the outside walls', () => {
    const middle = draft.walls.find((w) => w.thickness === 12)!;
    expect([middle.a.y, middle.b.y].sort((a, b) => a - b)).toEqual([
      wallAt(300, 100)!.a.y,
      wallAt(300, 700)!.a.y,
    ]);
  });

  it('puts openings on their walls, with the door swinging the way it was drawn', () => {
    const top = wallAt(420, 100)!;
    const window = draft.openings.find((o) => o.kind === 'window')!;
    expect(window.wallId).toBe(top.id);
    expect(Math.abs(window.offset - Math.abs(380 - top.a.x))).toBeLessThan(2);
    expect(window.width).toBeCloseTo(90, 0);
    const door = draft.openings.find((o) => o.kind === 'door')!;
    const middle = wallAt(500, 440)!;
    expect(door.wallId).toBe(middle.id);
    expect(door.width).toBeCloseTo(80, 0);
    // The leaf opens west, into the bedroom: the right of a wall running south.
    const south = middle.b.y > middle.a.y;
    expect(door.swing).toEqual({ hinge: south ? 'start' : 'end', side: south ? 'right' : 'left' });
  });

  it('drops an opening that is on no wall', () => {
    expect(draft.openings).toHaveLength(2);
  });

  it("moves rooms onto the walls' center lines", () => {
    const [bedroom, living] = draft.rooms;
    expect(bedroom).toMatchObject({ id: 'r1', label: 'BEDROOM' });
    expect(living).toMatchObject({ id: 'r2', type: 'living_room' });
    const xs = bedroom!.polygon.map((p) => Math.round(p.x));
    expect(new Set(xs)).toEqual(new Set([Math.round(wallAt(100, 400)!.a.x), 500]));
  });

  it('squares up fixtures and keeps the text that has any', () => {
    expect(draft.obstacles[0]!.polygon).toEqual([
      P(700, 640),
      P(889, 640),
      P(889, 690),
      P(700, 690),
    ]);
    expect(draft.texts).toEqual([{ id: 't1', text: 'BEDROOM', bbox: raw.texts[0]!.bbox }]);
  });
});
