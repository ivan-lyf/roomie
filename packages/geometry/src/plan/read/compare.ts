import type { OpeningKind, Vec2, Wall } from '@roomie/schema';
import type { PlanShapes } from '../edit';
import { bounds, contains } from '../polygon';
import { closestOnSegment, distance } from '../snap';
import { doorSwing, pointAlong, wallDirection, wallLength } from '../walls';

// How close a plan read off an image is to the plan as it should be, for the reader's eval
// (PLAN.md §2: walls, openings and rooms right after a few minutes of correction).

export type CompareOptions = {
  /** A wall counts as found when its center line is this close… */
  wallDistance: number;
  /** …and this close to parallel. */
  wallAngle: number;
  /** An opening counts as found when one of its kind is centered this close. */
  openingDistance: number;
  /** Rooms are the same room when they overlap this much (intersection over union). */
  roomOverlap: number;
};

export const COMPARE_DEFAULTS: CompareOptions = {
  wallDistance: 0.15,
  wallAngle: (5 * Math.PI) / 180,
  openingDistance: 0.3,
  roomOverlap: 0.5,
};

export type PlanComparison = {
  /** By length: how much of the true walls was found, and how much of what was found is real. */
  walls: { recall: number; precision: number };
  openings: { recall: number; precision: number; found: number; truth: number };
  /** Of the doors found, how many swing the right way. */
  doors: { matched: number; swingRight: number };
  rooms: {
    truth: number;
    /** True rooms with a read room over them. */
    matched: number;
    /** True rooms whose read room has the right type: the ≥ 90% goal. */
    typed: number;
    meanOverlap: number;
  };
};

/** Points every `step` meters along a wall, ends included. */
function samples(wall: Wall, step = 0.05): Vec2[] {
  const length = wallLength(wall);
  const n = Math.max(1, Math.ceil(length / step));
  return Array.from({ length: n + 1 }, (_, i) => pointAlong(wall, (length * i) / n));
}

/** The share of `walls`' length that lies on some wall in `others`. */
function wallCoverage(walls: readonly Wall[], others: readonly Wall[], o: CompareOptions): number {
  let total = 0;
  let covered = 0;
  for (const wall of walls) {
    const d = wallDirection(wall);
    const near = others.filter((w) => {
      const e = wallDirection(w);
      return Math.acos(Math.min(1, Math.abs(d.x * e.x + d.y * e.y))) <= o.wallAngle;
    });
    const points = samples(wall);
    const weight = wallLength(wall) / points.length;
    for (const p of points) {
      total += weight;
      if (near.some((w) => distance(p, closestOnSegment(p, w).point) <= o.wallDistance)) {
        covered += weight;
      }
    }
  }
  return total === 0 ? 1 : covered / total;
}

type PlacedOpening = { id: string; kind: OpeningKind; at: Vec2 };

function placedOpenings(plan: PlanShapes): PlacedOpening[] {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  return plan.openings.flatMap((o) => {
    const wall = walls.get(o.wallId);
    return wall ? [{ id: o.id, kind: o.kind, at: pointAlong(wall, o.offset + o.width / 2) }] : [];
  });
}

/** Pairs each true opening with the nearest unpaired one of its kind found, nearest first. */
function matchOpenings(truth: PlanShapes, found: PlanShapes, o: CompareOptions) {
  const t = placedOpenings(truth);
  const f = placedOpenings(found);
  const pairs = t
    .flatMap((a) =>
      f.filter((b) => b.kind === a.kind).map((b) => ({ a, b, d: distance(a.at, b.at) })),
    )
    .filter((p) => p.d <= o.openingDistance)
    .sort((p, q) => p.d - q.d);
  // Both plans number their openings o1, o2…, so each keeps its own list of what's paired.
  const usedTruth = new Set<string>();
  const usedFound = new Set<string>();
  const matched: [string, string][] = [];
  for (const { a, b } of pairs) {
    if (usedTruth.has(a.id) || usedFound.has(b.id)) continue;
    usedTruth.add(a.id);
    usedFound.add(b.id);
    matched.push([a.id, b.id]);
  }
  return { matched, truth: t.length, found: f.length };
}

/** Whether two doors swing the same way: hinged at the same jamb, opening to the same side. */
function sameSwing(truth: PlanShapes, found: PlanShapes, ids: [string, string]): boolean {
  const swing = (plan: PlanShapes, id: string) => {
    const o = plan.openings.find((x) => x.id === id)!;
    const wall = plan.walls.find((w) => w.id === o.wallId)!;
    return doorSwing(wall, o);
  };
  const a = swing(truth, ids[0]);
  const b = swing(found, ids[1]);
  if (!a || !b) return false;
  const opens = a.open.x * b.open.x + a.open.y * b.open.y > 0.7;
  return opens && distance(a.hinge, b.hinge) <= Math.max(a.radius, b.radius) / 2;
}

/** How much two polygons overlap: intersection over union, sampled on a 5 cm grid. */
export function overlap(p: readonly Vec2[], q: readonly Vec2[], step = 0.05): number {
  const box = bounds([...p, ...q]);
  let both = 0;
  let either = 0;
  for (let y = box.min.y + step / 2; y < box.max.y; y += step) {
    for (let x = box.min.x + step / 2; x < box.max.x; x += step) {
      const inP = contains(p, { x, y });
      const inQ = contains(q, { x, y });
      if (inP && inQ) both++;
      if (inP || inQ) either++;
    }
  }
  return either === 0 ? 0 : both / either;
}

/** Compares a plan read off an image with the plan as it should be, both in meters. */
export function comparePlans(
  truth: PlanShapes,
  found: PlanShapes,
  options: Partial<CompareOptions> = {},
): PlanComparison {
  const o = { ...COMPARE_DEFAULTS, ...options };
  const openings = matchOpenings(truth, found, o);
  const kinds = new Map(truth.openings.map((x) => [x.id, x.kind]));
  const doors = openings.matched.filter(([id]) => kinds.get(id) === 'door');

  let matched = 0;
  let typed = 0;
  let overlapSum = 0;
  for (const room of truth.rooms) {
    const best = found.rooms
      .map((r) => ({ r, iou: overlap(room.boundary, r.boundary) }))
      .sort((a, b) => b.iou - a.iou)[0];
    if (!best || best.iou < o.roomOverlap) continue;
    matched++;
    overlapSum += best.iou;
    if (best.r.roomType === room.roomType) typed++;
  }

  return {
    walls: {
      recall: wallCoverage(truth.walls, found.walls, o),
      precision: wallCoverage(found.walls, truth.walls, o),
    },
    openings: {
      recall: openings.truth === 0 ? 1 : openings.matched.length / openings.truth,
      precision: openings.found === 0 ? 1 : openings.matched.length / openings.found,
      found: openings.found,
      truth: openings.truth,
    },
    doors: {
      matched: doors.length,
      swingRight: doors.filter((pair) => sameSwing(truth, found, pair)).length,
    },
    rooms: {
      truth: truth.rooms.length,
      matched,
      typed,
      meanOverlap: matched === 0 ? 0 : overlapSum / matched,
    },
  };
}
