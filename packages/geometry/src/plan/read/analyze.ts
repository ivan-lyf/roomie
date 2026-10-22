import type { PlanDraft, RoomType, Scale, ScaleCandidate, SourceUnit, Vec2 } from '@roomie/schema';
import {
  type PlanTextReading,
  readPlanText,
  ROOM_NAMES,
  roomNameFromLabel,
  roomTypeFromLabel,
  uniqueRoomName,
} from '../labels';
import { area, bounds, contains } from '../polygon';
import { roomWalls } from '../rooms';
import {
  detectScale,
  type LengthSample,
  median,
  scaleFromSamples,
  type UnitHypothesis,
} from '../scale';

// What code reads off a tidied draft (PLAN.md §5.1): which text belongs to which room, what each
// room is, its ceiling, and the scale the dimension and area labels give. The model's own guesses
// only fill in where the plan's text says nothing.

/**
 * One polygon can hold labels of several types when an open plan was read as one room; it takes
 * the first of these.
 */
const TYPE_PRIORITY: readonly RoomType[] = [
  'studio',
  'living_room',
  'bedroom',
  'den_office',
  'dining_area',
  'kitchen',
  'bathroom',
  'laundry',
  'hallway',
  'closet',
  'balcony',
  'other',
];

/** Labels give room sizes either center to center of the walls, or inside them. */
export type LabelConvention = 'center' | 'inside';

export type DraftRoom = {
  type: RoomType;
  name: string;
  /** The draft text inside it. */
  textIds: string[];
  /** A ceiling height its own labels give. */
  ceiling?: number;
};

export type DraftScale =
  | { status: 'found'; scale: Scale }
  | { status: 'ask'; candidates: ScaleCandidate[] }
  | { status: 'none' };

export type DraftAnalysis = {
  texts: Map<string, PlanTextReading>;
  rooms: Map<string, DraftRoom>;
  /** The home's ceiling height, when the plan gives one. */
  ceiling?: number;
  scale: DraftScale;
};

const center = (box: { x: number; y: number; w: number; h: number }): Vec2 => ({
  x: box.x + box.w / 2,
  y: box.y + box.h / 2,
});

const sameText = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

function perimeter(points: readonly Vec2[]): number {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]!;
    return sum + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);
}

/**
 * How well labels agree on one scale: their mean distance from the best fit, each capped at 10%
 * so a misread label can't decide. The median `scaleFromSamples` reports would ignore the few
 * small rooms that tell the two conventions apart.
 */
function spread(samples: readonly LengthSample[]): number {
  const fit = scaleFromSamples(samples);
  if (!fit) return Infinity;
  const off = samples.map((s) =>
    Math.min(Math.abs((s.pixels * fit.metersPerPixel) / s.meters - 1), 0.1),
  );
  return off.reduce((sum, o) => sum + o, 0) / off.length;
}

/** Reads a tidied draft: its text, its rooms, its ceiling and its scale. */
export function analyzeDraft(draft: PlanDraft): DraftAnalysis {
  const texts = new Map(draft.texts.map((t) => [t.id, readPlanText(t.text)]));

  // Text belongs to the room its middle is in, or to the room the reader said it named.
  const roomTexts = new Map(draft.rooms.map((r) => [r.id, [] as string[]]));
  for (const t of draft.texts) {
    const c = center(t.bbox);
    const room =
      draft.rooms.find((r) => contains(r.polygon, c)) ??
      draft.rooms.find((r) => r.label !== undefined && sameText(r.label, t.text));
    roomTexts.get(room?.id ?? '')?.push(t.id);
  }

  const rooms = new Map<string, DraftRoom>();
  const taken: string[] = [];
  for (const r of draft.rooms) {
    const textIds = roomTexts.get(r.id)!;
    const labels = draft.texts
      .filter((t) => textIds.includes(t.id) && texts.get(t.id)!.roomType)
      .toSorted(
        (a, b) =>
          TYPE_PRIORITY.indexOf(texts.get(a.id)!.roomType!) -
          TYPE_PRIORITY.indexOf(texts.get(b.id)!.roomType!),
      );
    const named = labels[0];
    const fromReader = r.label ? roomTypeFromLabel(r.label) : undefined;
    const type = (named && texts.get(named.id)!.roomType) ?? r.type ?? fromReader ?? 'other';
    const nameText = named?.text ?? (fromReader === type ? r.label : undefined);
    const name = uniqueRoomName(
      taken,
      nameText ? roomNameFromLabel(nameText, type) : ROOM_NAMES[type],
    );
    taken.push(name);
    const ceiling = textIds.map((id) => texts.get(id)!.ceiling).find((c) => c !== undefined);
    rooms.set(r.id, { type, name, textIds, ...(ceiling !== undefined && { ceiling }) });
  }

  const ceilings = [...texts.values()].flatMap((t) => (t.ceiling ? [t.ceiling] : []));
  return {
    texts,
    rooms,
    ...(ceilings.length > 0 && { ceiling: median(ceilings) }),
    scale: draftScale(draft, texts, rooms),
  };
}

/**
 * The scale the labels give. Each room's dimension label is paired with its width and depth
 * (longer with longer), and its area label with its area; a room with more than one of either
 * is left out. Every unit the labels could be in is a
 * hypothesis; for each, sizes measured center to center and inside the walls are both tried,
 * and the convention the labels agree with best is kept. `detectScale` then checks doors and
 * room sizes to choose the unit, or to ask.
 */
function draftScale(
  draft: PlanDraft,
  texts: Map<string, PlanTextReading>,
  rooms: Map<string, DraftRoom>,
): DraftScale {
  const thickness = draft.walls.length > 0 ? median(draft.walls.map((w) => w.thickness)) : 0;
  const tolerance = Math.max(2, thickness / 2);
  type Samples = Record<LabelConvention, LengthSample[]> & { labelIds: Set<string> };
  const empty = (): Samples => ({ center: [], inside: [], labelIds: new Set() });
  const byUnit = new Map<SourceUnit, Samples>();
  const areas = empty();
  const areaUnits = new Set<'imperial' | 'metric'>();

  for (const room of draft.rooms) {
    const { min, max } = bounds(room.polygon);
    const sides = [max.x - min.x, max.y - min.y].sort((a, b) => b - a) as [number, number];
    const walls = roomWalls({ boundary: room.polygon }, draft.walls, tolerance);
    const inset = walls.length > 0 ? walls.reduce((s, w) => s + w.thickness, 0) / walls.length : 0;
    // A room holding two rooms' sizes (an open plan read as one) can't say which is its own.
    const ids = rooms.get(room.id)!.textIds;
    const sized = ids.filter((id) => texts.get(id)!.dimensions?.some((d) => d.meters.length === 2));
    const areaIds = ids.filter((id) => texts.get(id)!.area);
    for (const id of ids) {
      const reading = texts.get(id)!;
      for (const d of sized.length === 1 ? (reading.dimensions ?? []) : []) {
        if (d.meters.length !== 2) continue;
        const meters = d.meters.toSorted((a, b) => b - a);
        const samples = byUnit.get(d.unit) ?? empty();
        byUnit.set(d.unit, samples);
        meters.forEach((m, i) => {
          samples.center.push({ meters: m, pixels: sides[i]! });
          samples.inside.push({ meters: m, pixels: Math.max(sides[i]! - inset, 1) });
        });
        samples.labelIds.add(id);
      }
      if (reading.area && areaIds.length === 1) {
        const pixels = area(room.polygon);
        const inner = pixels - (perimeter(room.polygon) * inset) / 2 + inset * inset;
        const side = Math.sqrt(reading.area.squareMeters);
        areas.center.push({ meters: side, pixels: Math.sqrt(pixels) });
        areas.inside.push({ meters: side, pixels: Math.sqrt(Math.max(inner, 1)) });
        areas.labelIds.add(id);
        areaUnits.add(reading.area.unit);
      }
    }
  }
  // With no dimension labels, the area labels' own unit is the plan's.
  if (byUnit.size === 0 && areas.labelIds.size > 0) {
    byUnit.set(areaUnits.has('imperial') ? 'imperial' : 'metric_m', empty());
  }

  const conventions = new Map<SourceUnit, { convention: LabelConvention; labelIds: string[] }>();
  const hypotheses: UnitHypothesis[] = [...byUnit].map(([unit, s]) => {
    const fit = (c: LabelConvention) => [...s[c], ...areas[c]];
    const center = spread(fit('center'));
    const inside = spread(fit('inside'));
    // Labels give the inside more often, so it wins a tie.
    const convention: LabelConvention = center < inside - 0.002 ? 'center' : 'inside';
    conventions.set(unit, { convention, labelIds: [...s.labelIds, ...areas.labelIds] });
    return { unit, samples: fit(convention) };
  });

  const detection = detectScale(hypotheses, {
    doorPixels: draft.openings.filter((o) => o.kind === 'door').map((o) => o.width),
    rooms: draft.rooms.map((r) => {
      const { min, max } = bounds(r.polygon);
      return { type: rooms.get(r.id)!.type, pixels: [max.x - min.x, max.y - min.y] as const };
    }),
  });
  const toScale = (c: { unit: SourceUnit; metersPerPixel: number; residual: number }): Scale => ({
    metersPerPixel: c.metersPerPixel,
    sourceUnit: c.unit,
    method: 'labels',
    inputs: { ...conventions.get(c.unit) },
    residual: c.residual,
  });
  if (detection.status === 'found') return { status: 'found', scale: toScale(detection.candidate) };
  if (detection.status === 'ask') {
    return {
      status: 'ask',
      candidates: detection.candidates.map((c) => ({ ...toScale(c), plausible: c.plausible })),
    };
  }
  return { status: 'none' };
}
