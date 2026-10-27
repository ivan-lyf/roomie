import {
  FURNISHABLE,
  type Floorplan,
  type PlanDraft,
  type PlanText,
  type Scale,
  type Vec2,
} from '@roomie/schema';
import { defaultOpeningHeight } from '../heights';
import type { PlanTextReading } from '../labels';
import { contains } from '../polygon';
import { analyzeDraft, type DraftAnalysis } from './analyze';

/** A room's own ceiling label counts when it's this far from the home's. */
const CEILING_DIFFERENCE = 0.05;
/**
 * Readers draw walls 2–4 times too thick (15–46 cm, where most are partitions). A wall with a
 * room on both sides that's read thicker than `INSIDE_MAX` becomes `INSIDE_WALL`: a 2x4 stud
 * wall with drywall, which also covers the thinner European partitions.
 */
const INSIDE_MAX = 0.15;
const INSIDE_WALL = 0.12;
/** Outside walls (or ones with a room on one side only) stay within what's built. */
const OUTSIDE_MIN = 0.15;
const OUTSIDE_MAX = 0.35;
/** How far past a wall's face to look for a room on each side. */
const SIDE_PROBE = 0.05;

/** A read wall's thickness in meters, kept to what an inside or outside wall really is. */
function wallThickness(wall: PlanDraft['walls'][number], rooms: PlanDraft['rooms'], m: number) {
  const thickness = wall.thickness * m;
  const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  if (length === 0) return Math.min(Math.max(thickness, OUTSIDE_MIN), OUTSIDE_MAX);
  const mid = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
  const off = wall.thickness / 2 + SIDE_PROBE / m;
  const normal = { x: (wall.a.y - wall.b.y) / length, y: (wall.b.x - wall.a.x) / length };
  const roomAt = (side: number) => {
    const p = { x: mid.x + normal.x * off * side, y: mid.y + normal.y * off * side };
    return rooms.some((r) => contains(r.polygon, p));
  };
  if (roomAt(1) && roomAt(-1)) return thickness > INSIDE_MAX ? INSIDE_WALL : thickness;
  return Math.min(Math.max(thickness, OUTSIDE_MIN), OUTSIDE_MAX);
}

export type ConvertedDraft = Pick<
  Floorplan,
  'walls' | 'openings' | 'rooms' | 'obstacles' | 'labels'
>;

/** A piece of plan text as the floorplan keeps it, its lengths read in the plan's unit. */
function planText(
  text: PlanDraft['texts'][number],
  reading: PlanTextReading,
  unit: Scale['sourceUnit'],
): PlanText {
  const dimensions = reading.dimensions ?? [];
  const inUnit =
    dimensions.find((d) => d.unit === unit) ??
    (dimensions.length === 1 ? dimensions[0] : undefined);
  const meters =
    reading.kind === 'ceiling' && reading.ceiling !== undefined
      ? [reading.ceiling]
      : inUnit?.meters;
  const parsed = {
    ...(meters && { meters }),
    ...(reading.area && { squareMeters: reading.area.squareMeters }),
    ...(reading.roomType && { roomType: reading.roomType }),
  };
  return {
    id: text.id,
    text: text.text,
    bbox: text.bbox,
    kind: reading.kind,
    ...(Object.keys(parsed).length > 0 && { parsed }),
  };
}

/**
 * Converts a tidied draft to plan meters with its scale, once: walls, openings with the usual
 * heights under `ceilingHeight`, rooms typed and named from their labels, fixtures, and the
 * plan's text with its lengths in the scale's unit.
 */
export function convertDraft(
  draft: PlanDraft,
  scale: Pick<Scale, 'metersPerPixel' | 'sourceUnit'>,
  ceilingHeight: number,
  analysis: DraftAnalysis = analyzeDraft(draft),
): ConvertedDraft {
  const m = scale.metersPerPixel;
  const point = (p: Vec2): Vec2 => ({ x: p.x * m, y: p.y * m });
  return {
    walls: draft.walls.map((w) => ({
      ...w,
      a: point(w.a),
      b: point(w.b),
      thickness: wallThickness(w, draft.rooms, m),
    })),
    openings: draft.openings.map((o) => ({
      ...o,
      offset: o.offset * m,
      width: o.width * m,
      ...defaultOpeningHeight(o.kind, ceilingHeight),
    })),
    rooms: draft.rooms.map((r) => {
      const room = analysis.rooms.get(r.id)!;
      const ceiling =
        room.ceiling !== undefined && Math.abs(room.ceiling - ceilingHeight) > CEILING_DIFFERENCE
          ? room.ceiling
          : undefined;
      return {
        id: r.id,
        name: room.name,
        roomType: room.type,
        boundary: r.polygon.map(point),
        labelTextIds: room.textIds,
        furnishable: FURNISHABLE.has(room.type),
        ...(ceiling !== undefined && { ceilingHeight: ceiling }),
      };
    }),
    obstacles: draft.obstacles.map((o) => ({ ...o, polygon: o.polygon.map(point) })),
    labels: draft.texts.map((t) => planText(t, analysis.texts.get(t.id)!, scale.sourceUnit)),
  };
}
