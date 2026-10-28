import type { PlanDraft, RoomType, Scale, ScaleCandidate, SourceUnit, Vec2 } from '@roomie/schema';
import {
  type PlanTextReading,
  readPlanText,
  ROOM_NAMES,
  roomNameFromLabel,
  roomTypeFromLabel,
  uniqueRoomName,
} from '../labels';
import { bounds, contains } from '../polygon';
import { floorArea, roomWalls } from '../rooms';
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

/**
 * The building's overall width and depth, from the dimension lines beside it: for each unit and
 * direction, the longest single length printed just outside the walls along that side (the
 * overall size, not one of the parts given beside it), against the walls' outer faces.
 */
function overallSizes(
  draft: PlanDraft,
  texts: Map<string, PlanTextReading>,
  inRooms: ReadonlySet<string>,
): Map<SourceUnit, { samples: LengthSample[]; labelIds: string[] }> {
  const sizes = new Map<SourceUnit, { samples: LengthSample[]; labelIds: string[] }>();
  if (draft.walls.length === 0) return sizes;
  const corners = draft.walls.flatMap((w) => {
    const length = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
    const n = {
      x: ((w.b.y - w.a.y) / length) * (w.thickness / 2),
      y: (-(w.b.x - w.a.x) / length) * (w.thickness / 2),
    };
    return [w.a, w.b].flatMap((p) => [
      { x: p.x + n.x, y: p.y + n.y },
      { x: p.x - n.x, y: p.y - n.y },
    ]);
  });
  const { min, max } = bounds(corners);
  const [width, depth] = [max.x - min.x, max.y - min.y];
  const longest = new Map<string, { meters: number; id: string }>();
  for (const t of draft.texts) {
    if (inRooms.has(t.id)) continue;
    const c = center(t.bbox);
    const besideX = c.x > min.x && c.x < max.x;
    const besideY = c.y > min.y && c.y < max.y;
    const aboveOrBelow =
      besideX &&
      (c.y < min.y ? min.y - c.y : c.y - max.y) > 0 &&
      Math.max(min.y - c.y, c.y - max.y) < 0.25 * depth;
    const leftOrRight =
      besideY &&
      (c.x < min.x ? min.x - c.x : c.x - max.x) > 0 &&
      Math.max(min.x - c.x, c.x - max.x) < 0.25 * width;
    const axis = aboveOrBelow ? 'x' : leftOrRight ? 'y' : undefined;
    if (!axis) continue;
    for (const d of texts.get(t.id)!.dimensions ?? []) {
      if (d.meters.length !== 1) continue;
      const key = `${d.unit} ${axis}`;
      const known = longest.get(key);
      if (!known || d.meters[0]! > known.meters)
        longest.set(key, { meters: d.meters[0]!, id: t.id });
    }
  }
  for (const [key, { meters, id }] of longest) {
    const [unit, axis] = key.split(' ') as [SourceUnit, 'x' | 'y'];
    const entry = sizes.get(unit) ?? { samples: [], labelIds: [] };
    entry.samples.push({ meters, pixels: axis === 'x' ? width : depth, source: id });
    entry.labelIds.push(id);
    sizes.set(unit, entry);
  }
  return sizes;
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
      .toSorted((a, b) => {
        const [ra, rb] = [texts.get(a.id)!, texts.get(b.id)!];
        // "MASTER" over "BATH" is a master bath: a weak label loses to any other.
        const weak = Number(ra.weakRoomType ?? false) - Number(rb.weakRoomType ?? false);
        return weak || TYPE_PRIORITY.indexOf(ra.roomType!) - TYPE_PRIORITY.indexOf(rb.roomType!);
      });
    // A room holding labels of different types (a hall that caught the WC's label) takes the
    // one the reader said the room is, when that's among them.
    const strong = labels.filter((t) => !texts.get(t.id)!.weakRoomType);
    const conflict = new Set(strong.map((t) => texts.get(t.id)!.roomType)).size > 1;
    const named =
      (conflict && r.type && strong.find((t) => texts.get(t.id)!.roomType === r.type)) || labels[0];
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
    scale: draftScale(draft, texts, rooms, new Set([...roomTexts.values()].flat())),
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
  inRooms: ReadonlySet<string>,
): DraftScale {
  const thickness = draft.walls.length > 0 ? median(draft.walls.map((w) => w.thickness)) : 0;
  const tolerance = Math.max(2, thickness / 2);
  type Samples = Record<LabelConvention, LengthSample[]> & { labelIds: Set<string> };
  const empty = (): Samples => ({ center: [], inside: [], labelIds: new Set() });
  const byUnit = new Map<SourceUnit, Samples>();
  const areas: LengthSample[] = [];
  const areaLabelIds = new Set<string>();
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
          const source = room.id;
          samples.center.push({ meters: m, pixels: sides[i]!, source });
          samples.inside.push({ meters: m, pixels: Math.max(sides[i]! - inset, 1), source });
        });
        samples.labelIds.add(id);
      }
      if (reading.area && areaIds.length === 1) {
        // A room's printed area is its floor inside the walls, whichever way its sizes are given.
        const inner = floorArea(room.polygon, walls, tolerance);
        const side = Math.sqrt(reading.area.squareMeters);
        areas.push({ meters: side, pixels: Math.sqrt(Math.max(inner, 1)), source: room.id });
        areaLabelIds.add(id);
        areaUnits.add(reading.area.unit);
      }
    }
  }
  const overall = overallSizes(draft, texts, inRooms);
  for (const unit of overall.keys()) if (!byUnit.has(unit)) byUnit.set(unit, empty());
  // With no dimension labels, the area labels' own unit is the plan's.
  if (byUnit.size === 0 && areaLabelIds.size > 0) {
    byUnit.set(areaUnits.has('imperial') ? 'imperial' : 'metric_m', empty());
  }

  type Inputs = { convention: LabelConvention | 'overall'; labelIds: string[] };
  const conventions = new Map<SourceUnit, Inputs>();
  const hypotheses: UnitHypothesis[] = [...byUnit].map(([unit, s]) => {
    // The building's overall sizes beat room labels: they're long, and only need the outside
    // walls right.
    const outside = overall.get(unit);
    if (outside) {
      conventions.set(unit, { convention: 'overall', labelIds: outside.labelIds });
      return { unit, samples: outside.samples };
    }
    const fit = (c: LabelConvention) => [...s[c], ...areas];
    const center = spread(fit('center'));
    const inside = spread(fit('inside'));
    // Labels give the inside more often, so it wins a tie; with only areas, it's the inside.
    const convention: LabelConvention =
      s.center.length > 0 && center < inside - 0.002 ? 'center' : 'inside';
    conventions.set(unit, { convention, labelIds: [...s.labelIds, ...areaLabelIds] });
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
