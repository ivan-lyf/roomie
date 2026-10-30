import type { Placement } from '@roomie/schema';

// Which two layouts of a room to rate next (PLAN.md M7): every room gets some ratings, no pair
// is shown twice, and most pairs are the ones that teach the scorer the most.

/** One room as one logged layout has it. */
export type Version = {
  layoutId: string;
  floorplanId: string;
  roomId: string;
  /** The room's items in this layout. */
  placements: readonly Placement[];
  /** The room's score as logged. */
  score: number;
};

/** A rating already made, by its room and the two layouts. */
export type RatedPair = { layoutA: string; layoutB: string; roomId: string };

export type Pair = {
  floorplanId: string;
  roomId: string;
  /** Shown on the left. */
  a: Version;
  /** Shown on the right. */
  b: Version;
  /** The same pieces in both, so only where they stand differs. */
  samePieces: boolean;
};

/** Items this close count as standing in the same spot. */
export const SAME_SPOT = { meters: 0.1, radians: (15 * Math.PI) / 180 };
/** Scores this close make a close pair, which teaches the fit the most. */
export const CLOSE_SCORES = 0.1;
/** How often a pair has the same pieces, when the room has both kinds. */
export const SAME_PIECES_SHARE = 0.75;
/** How often a pair is close, when the room has both kinds. */
export const CLOSE_SHARE = 0.8;

/** The room's products, in order: two versions with the same are the same pieces. */
const piecesOf = (v: Version) =>
  v.placements
    .map((p) => p.articleNo)
    .toSorted()
    .join(',');

const turn = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};

/** The same pieces, each in the same spot as one of the other's: there's nothing to compare. */
export function sameLayout(a: Version, b: Version): boolean {
  if (piecesOf(a) !== piecesOf(b)) return false;
  const left = [...b.placements];
  return a.placements.every((p) => {
    const i = left.findIndex(
      (q) =>
        q.articleNo === p.articleNo &&
        Math.hypot(q.x - p.x, q.y - p.y) <= SAME_SPOT.meters &&
        turn(q.rotation, p.rotation) <= SAME_SPOT.radians,
    );
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
}

const pairKey = (x: string, y: string, roomId: string) =>
  `${roomId}|${[x, y].toSorted().join('|')}`;

/**
 * The next pair to rate: from the room with the fewest ratings that still has a pair not rated,
 * two of its versions, told apart, never a pair rated before. Most have the same pieces and close
 * scores; a few have other pieces, or scores far apart to check the scorer where it's sure. Each
 * version goes left or right at random. Undefined when every pair has been rated.
 */
export function pickPair(
  versions: readonly Version[],
  rated: readonly RatedPair[],
  random: () => number = Math.random,
): Pair | undefined {
  const done = new Set(rated.map((r) => pairKey(r.layoutA, r.layoutB, r.roomId)));
  const counts = new Map<string, number>();
  const rooms = new Map<string, Version[]>();
  for (const v of versions) {
    if (v.placements.length === 0) continue;
    const key = `${v.floorplanId}|${v.roomId}`;
    const distinct = rooms.get(key) ?? [];
    if (!distinct.some((d) => sameLayout(d, v))) distinct.push(v);
    rooms.set(key, distinct);
  }
  const byLayout = new Map(versions.map((v) => [v.layoutId, v]));
  for (const r of rated) {
    const v = byLayout.get(r.layoutA);
    if (v)
      counts.set(
        `${v.floorplanId}|${r.roomId}`,
        (counts.get(`${v.floorplanId}|${r.roomId}`) ?? 0) + 1,
      );
  }

  const open = [...rooms.entries()]
    .map(([key, list]) => ({
      key,
      pairs: list.flatMap((x, i) =>
        list
          .slice(i + 1)
          .filter((y) => !done.has(pairKey(x.layoutId, y.layoutId, x.roomId)))
          .map((y) => [x, y] as const),
      ),
    }))
    .filter((room) => room.pairs.length > 0);
  if (open.length === 0) return undefined;
  const fewest = Math.min(...open.map((r) => counts.get(r.key) ?? 0));
  const least = open.filter((r) => (counts.get(r.key) ?? 0) === fewest);
  const room = least[Math.floor(random() * least.length)]!;

  /** Keeps the pairs that pass, `share` of the time, when some pass and some don't. */
  const prefer = <T>(list: readonly T[], test: (x: T) => boolean, share: number): readonly T[] => {
    const yes = list.filter(test);
    const no = list.filter((x) => !test(x));
    if (yes.length === 0 || no.length === 0) return list;
    return random() < share ? yes : no;
  };
  let pairs = prefer(room.pairs, ([x, y]) => piecesOf(x) === piecesOf(y), SAME_PIECES_SHARE);
  pairs = prefer(pairs, ([x, y]) => Math.abs(x.score - y.score) <= CLOSE_SCORES, CLOSE_SHARE);
  const [x, y] = pairs[Math.floor(random() * pairs.length)]!;
  const [a, b] = random() < 0.5 ? [x, y] : [y, x];
  return {
    floorplanId: a.floorplanId,
    roomId: a.roomId,
    a,
    b,
    samePieces: piecesOf(a) === piecesOf(b),
  };
}
