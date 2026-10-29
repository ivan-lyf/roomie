import type { Vec2 } from '@roomie/schema';
import { bounds, contains } from '../plan/polygon';

// Walkways through a room, on a 5 cm grid over its floor: the free cells (not under furniture or
// a built-in) far enough from anything in the way for a 75 cm wide path to run through them.

/** How wide a path through a room must be, in meters. */
export const WALKWAY = 0.75;
/** The grid's cell, in meters: paths are measured to about half of it. */
const CELL = 0.05;

/** Where a path can start: a door's clear zone, or a strip along a side open to the next room. */
export type Entrance = { id: string; region: Vec2[] };
/** What a path must reach: an item's use zone, any part of it. */
export type Target = { id: string; parts: Vec2[][] };

export type Walkways = {
  /** Entrances cut off from the room's main walkway. */
  cutOff: string[];
  /** Targets no 75 cm path comes to. */
  unreached: string[];
};

type Grid = { x0: number; y0: number; nx: number; ny: number };

const center = (g: Grid, i: number): Vec2 => ({
  x: g.x0 + ((i % g.nx) + 0.5) * CELL,
  y: g.y0 + (Math.floor(i / g.nx) + 0.5) * CELL,
});

/** The cells whose centers are inside a polygon. */
function cellsIn(g: Grid, polygon: readonly Vec2[], into: (i: number) => void) {
  const { min, max } = bounds(polygon);
  const c0 = Math.max(0, Math.floor((min.x - g.x0) / CELL));
  const c1 = Math.min(g.nx - 1, Math.ceil((max.x - g.x0) / CELL));
  const r0 = Math.max(0, Math.floor((min.y - g.y0) / CELL));
  const r1 = Math.min(g.ny - 1, Math.ceil((max.y - g.y0) / CELL));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * g.nx + c;
      if (contains(polygon, center(g, i))) into(i);
    }
  }
}

/** Stands in for "no source anywhere": large, but finite, so the arithmetic below stays exact. */
const FAR = 1e20;

/** Squared distance transform along one line (Felzenszwalb and Huttenlocher). */
function line(f: Float64Array, n: number, out: Float64Array) {
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const meet = (q: number, p: number) => (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p);
  let k = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = meet(q, v[k]!);
    while (s <= z[k]!) s = meet(q, v[--k]!);
    v[++k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    out[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
  }
}

/**
 * Squared distance, in cells, from each cell to the nearest source cell; the grid's border
 * counts as a source when `walled`, so cells by the edge are near something.
 */
function distances(g: Grid, source: (i: number) => boolean, walled: boolean): Float64Array {
  // One cell of border all round.
  const [w, h] = [g.nx + 2, g.ny + 2];
  const d = new Float64Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const inside = r > 0 && c > 0 && r <= g.ny && c <= g.nx;
      const src = inside ? source((r - 1) * g.nx + (c - 1)) : walled;
      d[r * w + c] = src ? 0 : FAR;
    }
  }
  const f = new Float64Array(Math.max(w, h));
  const out = new Float64Array(Math.max(w, h));
  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) f[r] = d[r * w + c]!;
    line(f, h, out);
    for (let r = 0; r < h; r++) d[r * w + c] = out[r]!;
  }
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) f[c] = d[r * w + c]!;
    line(f, w, out);
    for (let c = 0; c < w; c++) d[r * w + c] = out[c]!;
  }
  const inner = new Float64Array(g.nx * g.ny);
  for (let r = 0; r < g.ny; r++) {
    for (let c = 0; c < g.nx; c++) inner[r * g.nx + c] = d[(r + 1) * w + (c + 1)]!;
  }
  return inner;
}

/** The connected groups of marked cells (4-neighbours), as a group number per cell, or -1. */
function groups(g: Grid, marked: Uint8Array): Int32Array {
  const group = new Int32Array(marked.length).fill(-1);
  let next = 0;
  const queue = new Int32Array(marked.length);
  for (let start = 0; start < marked.length; start++) {
    if (!marked[start] || group[start] !== -1) continue;
    let [head, tail] = [0, 0];
    queue[tail++] = start;
    group[start] = next;
    while (head < tail) {
      const i = queue[head++]!;
      const [c, r] = [i % g.nx, Math.floor(i / g.nx)];
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const [cc, rr] = [c + dc, r + dr];
        if (cc < 0 || rr < 0 || cc >= g.nx || rr >= g.ny) continue;
        const j = rr * g.nx + cc;
        if (marked[j] && group[j] === -1) {
          group[j] = next;
          queue[tail++] = j;
        }
      }
    }
    next++;
  }
  return group;
}

/**
 * Checks the walkways through a room's floor around what stands on it: that the entrances all
 * join up through a path 75 cm wide, and that such a path comes to each target. The main walkway
 * is the one joining the most entrances. `beyond` is floor past the room's open sides, where a
 * path can widen into the next room.
 */
export function walkways(
  floor: readonly Vec2[],
  beyond: readonly (readonly Vec2[])[],
  blockers: readonly (readonly Vec2[])[],
  entrances: readonly Entrance[],
  targets: readonly Target[],
): Walkways {
  if (entrances.length === 0) return { cutOff: [], unreached: [] };
  const { min, max } = bounds([floor, ...beyond].flat());
  const g: Grid = {
    x0: min.x,
    y0: min.y,
    nx: Math.max(1, Math.ceil((max.x - min.x) / CELL)),
    ny: Math.max(1, Math.ceil((max.y - min.y) / CELL)),
  };
  const free = new Uint8Array(g.nx * g.ny);
  for (const area of [floor, ...beyond]) cellsIn(g, area, (i) => (free[i] = 1));
  for (const b of blockers) cellsIn(g, b, (i) => (free[i] = 0));

  const half = WALKWAY / 2 / CELL;
  const near = distances(g, (i) => !free[i], true);
  const walkable = new Uint8Array(free.length);
  for (let i = 0; i < free.length; i++) {
    walkable[i] = free[i] && near[i]! >= half * half - 1e-9 ? 1 : 0;
  }

  const group = groups(g, walkable);
  const touches = entrances.map((e) => {
    const found = new Set<number>();
    cellsIn(g, e.region, (i) => group[i]! >= 0 && found.add(group[i]!));
    return found;
  });
  const counts = new Map<number, number>();
  for (const t of touches) for (const n of t) counts.set(n, (counts.get(n) ?? 0) + 1);
  const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const cutOff = entrances.filter((_, i) => main === undefined || !touches[i]!.has(main));

  // What a 75 cm wide walker on the main walkway sweeps: within half the width of its cells.
  const swept = main === undefined ? undefined : distances(g, (i) => group[i] === main, false);
  const reach = (half + 1) * (half + 1);
  const unreached = targets.filter((t) => {
    if (!swept) return true;
    let hit = false;
    for (const part of t.parts) cellsIn(g, part, (i) => (hit ||= swept[i]! <= reach));
    return !hit;
  });
  return { cutOff: cutOff.map((e) => e.id), unreached: unreached.map((t) => t.id) };
}
