import type { Category, Floorplan, Placement, Vec2 } from '@roomie/schema';
import { doorSwing, leftNormal, pointAlong, wallDirection } from '../plan/walls';
import { localRect, type ProductFit } from './shapes';

/** How the space an item needs is laid out around it. */
type ZoneRule = {
  /** How far it reaches, in meters. */
  depth: number;
  /** In front, along the long sides (beds), or on every side (tables). */
  where: 'front' | 'sides' | 'around';
  /** What may stand in it: a rug always, and the item's own companions. */
  allows: readonly Category[];
};

/**
 * The space each kind of item needs clear to be used, from common furniture-planning minimums
 * (PLAN.md M3). One table, to tune once ratings come in (M7).
 */
export const USE_ZONES: Partial<Record<Category, ZoneRule>> = {
  bed: { depth: 0.6, where: 'sides', allows: ['rug'] },
  sofa: { depth: 0.35, where: 'front', allows: ['rug'] },
  armchair: { depth: 0.35, where: 'front', allows: ['rug'] },
  desk: { depth: 0.75, where: 'front', allows: ['rug', 'desk_chair', 'dining_chair'] },
  dining_table: { depth: 0.6, where: 'around', allows: ['rug', 'dining_chair', 'desk_chair'] },
  wardrobe: { depth: 0.6, where: 'front', allows: ['rug'] },
  dresser: { depth: 0.6, where: 'front', allows: ['rug'] },
  shelving: { depth: 0.6, where: 'front', allows: ['rug'] },
  tv_unit: { depth: 0.6, where: 'front', allows: ['rug'] },
};

/** Beds this wide or wider sleep two, so both sides need the space. */
export const DOUBLE_BED = 1.4;
/** The head end of a bed, this share of its length, is the nightstands' and needs no space. */
const BED_HEAD = 1 / 3;

/**
 * The space an item needs clear: one or more rectangles on the plan, of which `need` says
 * whether all must be clear or any one will do (a single bed against a wall).
 */
export type UseZone = {
  parts: Vec2[][];
  need: 'all' | 'any';
  depth: number;
  allows: ReadonlySet<Category>;
};

export function useZone(
  placement: Pick<Placement, 'x' | 'y' | 'rotation'>,
  product: ProductFit,
): UseZone | undefined {
  const rule = USE_ZONES[product.category];
  if (!rule) return undefined;
  const [w, d, z] = [product.dims.w / 2, product.dims.d / 2, rule.depth];
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    localRect(placement, x0, y0, x1, y1);
  const base = { depth: z, allows: new Set(rule.allows) };
  switch (rule.where) {
    case 'front':
      return { ...base, parts: [rect(-w, d, w, d + z)], need: 'all' };
    case 'sides': {
      // From a third of the way back from the head (the back of the bed) to the foot.
      const from = -d + 2 * d * BED_HEAD;
      const parts = [rect(-w - z, from, -w, d), rect(w, from, w + z, d)];
      return { ...base, parts, need: product.dims.w >= DOUBLE_BED ? 'all' : 'any' };
    }
    case 'around':
      return {
        ...base,
        parts: [
          rect(-w, d, w, d + z),
          rect(-w, -d - z, w, -d),
          rect(-w - z, -d, -w, d),
          rect(w, -d, w + z, d),
        ],
        need: 'all',
      };
  }
}

/** How far in front of a door or open doorway stays clear, on both sides of its wall. */
export const DOOR_CLEARANCE = 0.6;
/** Segments of the arc a door's leaf sweeps. */
const ARC_STEPS = 8;

/** The floor a door or open doorway needs clear: in front of it on both sides, and its swing. */
export type DoorZone = { openingId: string; wallId: string; parts: Vec2[][] };

export function doorZones(plan: Pick<Floorplan, 'walls' | 'openings'>): DoorZone[] {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  const zones: DoorZone[] = [];
  for (const opening of plan.openings) {
    const wall = walls.get(opening.wallId);
    if (!wall || opening.kind === 'window') continue;
    const n = leftNormal(wallDirection(wall));
    const start = pointAlong(wall, opening.offset);
    const end = pointAlong(wall, opening.offset + opening.width);
    const off = (p: Vec2, by: number) => ({ x: p.x + n.x * by, y: p.y + n.y * by });
    const face = wall.thickness / 2;
    const parts = [1, -1].map((side) => [
      off(start, side * face),
      off(end, side * face),
      off(end, side * (face + DOOR_CLEARANCE)),
      off(start, side * (face + DOOR_CLEARANCE)),
    ]);
    const swing = doorSwing(wall, opening);
    if (swing) {
      const { hinge, closed, open, radius } = swing;
      const arc = Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
        const t = ((Math.PI / 2) * i) / ARC_STEPS;
        return {
          x: hinge.x + (closed.x * Math.cos(t) + open.x * Math.sin(t)) * radius,
          y: hinge.y + (closed.y * Math.cos(t) + open.y * Math.sin(t)) * radius,
        };
      });
      parts.push([hinge, ...arc]);
    }
    zones.push({ openingId: opening.id, wallId: wall.id, parts });
  }
  return zones;
}
