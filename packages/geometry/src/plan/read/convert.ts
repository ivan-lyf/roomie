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
import { analyzeDraft, type DraftAnalysis } from './analyze';

/** A room's own ceiling label counts when it's this far from the home's. */
const CEILING_DIFFERENCE = 0.05;

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
  const meters = reading.ceiling !== undefined ? [reading.ceiling] : inUnit?.meters;
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
      thickness: w.thickness * m,
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
