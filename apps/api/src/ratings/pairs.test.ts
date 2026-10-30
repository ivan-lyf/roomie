import { seeded } from '@roomie/geometry';
import type { Placement } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import {
  CLOSE_SCORES,
  compared,
  compareTally,
  pickComparePair,
  pickPair,
  type RatedPair,
  sameLayout,
  type Version,
} from './pairs';

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

describe('the blind check of other weights', () => {
  /** A run's winner for room r1 or r2, placed by the given weights. */
  const run = (layoutId: string, weights: string, x: number, roomId = 'r1', seeds = '9,10') =>
    version(layoutId, x, 0.8, {
      weights,
      winner: true,
      run: seeds,
      roomId,
      placements: version(layoutId, x).placements.map((p) => ({ ...p, roomId })),
    });
  const versions = [
    run('c1', 'current', 1),
    run('f1', 'fitted', 2),
    // Another room the weights placed the same.
    run('c2', 'current', 1, 'r2'),
    run('f2', 'fitted', 1.02, 'r2'),
    // A candidate, and a room another weight set placed: neither is compared.
    { ...run('c3', 'current', 0.5), winner: false },
    run('o1', 'other', 3),
    // An ordinary pool layout of the same room.
    version('p1', 2.5),
  ];

  it('pairs each room’s winners from the same run, the current weights against the others', () => {
    const rooms = compared(versions, 'fitted');
    expect(rooms.map((r) => [r.current.layoutId, r.other.layoutId, r.same])).toEqual([
      ['c1', 'f1', false],
      ['c2', 'f2', true],
    ]);
    const random = seeded(4);
    const sides = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const pair = pickComparePair(versions, [], 'fitted', random)!;
      expect([pair.a.layoutId, pair.b.layoutId].toSorted()).toEqual(['c1', 'f1']);
      sides.add(pair.a.layoutId);
    }
    expect(sides.size).toBe(2);
    expect(
      pickComparePair(versions, [{ layoutA: 'f1', layoutB: 'c1', roomId: 'r1' }], 'fitted'),
    ).toBeUndefined();
  });

  it('tallies which weights’ room was picked', () => {
    const rated = [{ layoutA: 'f1', layoutB: 'c1', roomId: 'r1', winner: 'a' as const }];
    expect(compareTally(versions, rated, 'fitted')).toEqual({
      name: 'fitted',
      rooms: 2,
      same: 1,
      rated: 1,
      wins: 1,
      losses: 0,
      ties: 0,
    });
    const lost = [{ ...rated[0]!, winner: 'b' as const }];
    expect(compareTally(versions, lost, 'fitted')).toMatchObject({ wins: 0, losses: 1 });
  });
});
