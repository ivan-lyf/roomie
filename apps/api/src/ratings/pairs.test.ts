import { seeded } from '@roomie/geometry';
import type { Placement } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { CLOSE_SCORES, pickPair, type RatedPair, sameLayout, type Version } from './pairs';

const item = (id: string, articleNo: string, x: number, y = 1, rotation = 0): Placement => ({
  id,
  articleNo,
  roomId: 'r1',
  x,
  y,
  rotation,
});

/** A version of room r1 of home h1: a sofa at x and a table, scored `score`. */
const version = (layoutId: string, x: number, score = 0.8, extra: Partial<Version> = {}) => ({
  layoutId,
  floorplanId: 'h1',
  roomId: 'r1',
  placements: [item('f1', '900.000.10', x), item('f2', '900.000.20', 3)],
  score,
  ...extra,
});

describe('sameLayout', () => {
  const a = version('a', 1);
  it('counts items within 10 cm and 15° of each other as the same spot', () => {
    expect(sameLayout(a, version('b', 1.05))).toBe(true);
    expect(sameLayout(a, version('b', 1.3))).toBe(false);
    const turned = {
      ...a,
      placements: [item('f1', '900.000.10', 1, 1, Math.PI / 2), a.placements[1]!],
    };
    expect(sameLayout(a, turned)).toBe(false);
    // A full turn is no turn.
    const around = {
      ...a,
      placements: [item('f1', '900.000.10', 1, 1, 2 * Math.PI), a.placements[1]!],
    };
    expect(sameLayout(a, around)).toBe(true);
  });

  it('tells apart other pieces in the same spots', () => {
    const other = { ...a, placements: [item('f1', '900.000.11', 1), a.placements[1]!] };
    expect(sameLayout(a, other)).toBe(false);
    expect(sameLayout(a, { ...a, placements: [a.placements[0]!] })).toBe(false);
  });
});

describe('pickPair', () => {
  it('rates every pair of a room once, never the same layout twice over', () => {
    const versions = [version('a', 1), version('b', 2), version('c', 2.02), version('d', 0.5)];
    const rated: RatedPair[] = [];
    const random = seeded(1);
    for (;;) {
      const pair = pickPair(versions, rated, random);
      if (!pair) break;
      rated.push({ layoutA: pair.a.layoutId, layoutB: pair.b.layoutId, roomId: pair.roomId });
    }
    // c is b again, so three versions: three pairs.
    expect(rated).toHaveLength(3);
    const keys = rated.map((r) => [r.layoutA, r.layoutB].toSorted().join());
    expect(new Set(keys).size).toBe(3);
    expect(keys.some((k) => k.includes('c'))).toBe(false);
  });

  it('goes to the room with the fewest ratings first', () => {
    const versions = [
      version('a', 1),
      version('b', 2),
      version('c', 0.5),
      version('x', 1, 0.8, { roomId: 'r2' }),
      version('y', 2, 0.8, { roomId: 'r2' }),
    ];
    const rated = [{ layoutA: 'a', layoutB: 'b', roomId: 'r1' }];
    for (let seed = 1; seed <= 20; seed++) {
      expect(pickPair(versions, rated, seeded(seed))!.roomId).toBe('r2');
    }
  });

  it('leaves out rooms with no furniture', () => {
    const empty = { placements: [] };
    expect(
      pickPair([version('a', 1, 0.8, empty), version('b', 2, 0.8, empty)], []),
    ).toBeUndefined();
  });

  it('mostly shows the same pieces with close scores, and each side as often', () => {
    const otherPieces = (id: string, x: number, score: number) =>
      version(id, x, score, {
        placements: [item('f1', '900.000.11', x), item('f2', '900.000.20', 3)],
      });
    const versions = [
      version('a', 1, 0.8),
      version('b', 2, 0.82),
      version('c', 0.5, 0.5),
      otherPieces('d', 1.5, 0.81),
    ];
    const random = seeded(7);
    const n = 2000;
    let [same, close, withA, aLeft] = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const pair = pickPair(versions, [], random)!;
      if (pair.samePieces) same++;
      if (Math.abs(pair.a.score - pair.b.score) <= CLOSE_SCORES) close++;
      if (pair.a.layoutId === 'a' || pair.b.layoutId === 'a') withA++;
      if (pair.a.layoutId === 'a') aLeft++;
    }
    expect(same / n).toBeCloseTo(0.75, 1);
    // Either way, one pair in five is far apart: here, those with c.
    expect(close / n).toBeCloseTo(0.8, 1);
    expect(aLeft / withA).toBeCloseTo(0.5, 1);
  });
});
