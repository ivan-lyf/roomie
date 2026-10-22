import type { Floorplan, RoomType, SourceUnit } from '@roomie/schema';
import { bounds } from './polygon';

// One meters-per-pixel scale for the whole image, from the plan's labels or the user's
// measurements (PLAN.md §5.1). Everything is converted to meters with it, once.

/** A known length on the plan: what a label (or the user) says it is, against its pixels. */
export type LengthSample = { meters: number; pixels: number };

export type ScaleFit = { metersPerPixel: number; residual: number };

/** How far the samples are from a scale: the median of |measured / stated − 1|. */
export function residual(metersPerPixel: number, samples: readonly LengthSample[]): number {
  return median(samples.map((s) => Math.abs((s.pixels * metersPerPixel) / s.meters - 1)));
}

/** The scale that fits known lengths best: their median ratio, so one bad label can't skew it. */
export function scaleFromSamples(samples: readonly LengthSample[]): ScaleFit | undefined {
  const usable = samples.filter((s) => s.meters > 0 && s.pixels > 0);
  if (usable.length === 0) return undefined;
  const metersPerPixel = median(usable.map((s) => s.meters / s.pixels));
  return { metersPerPixel, residual: residual(metersPerPixel, usable) };
}

/** Indexes of the samples off the scale by more than `tolerance`, for the editor to flag. */
export function disagreeing(
  metersPerPixel: number,
  samples: readonly LengthSample[],
  tolerance = 0.03,
): number[] {
  return samples.flatMap((s, i) =>
    Math.abs((s.pixels * metersPerPixel) / s.meters - 1) > tolerance ? [i] : [],
  );
}

/** One reading of the labels: the lengths they give if they're in `unit`. */
export type UnitHypothesis = { unit: SourceUnit; samples: LengthSample[] };

/** What else on the plan a scale has to make sense of. */
export type Evidence = {
  /** Widths of the doors, in pixels. */
  doorPixels: readonly number[];
  /** Each room's width and depth in pixels, with its type when known. */
  rooms: readonly { type?: RoomType; pixels: readonly [number, number] }[];
};

export type UnitCandidate = ScaleFit & { unit: SourceUnit; plausible: boolean };

export type ScaleDetection =
  | { status: 'found'; candidate: UnitCandidate }
  | { status: 'ask'; candidates: UnitCandidate[] }
  | { status: 'none' };

/** Doors are 0.6–1.0 m wide. */
const DOOR_WIDTH: [number, number] = [0.6, 1.0];
/** Any room side outside this range means the unit is wrong. */
const ROOM_SIDE: [number, number] = [0.6, 15];
/** Labels disagreeing more than this mean the unit (or the labels) is wrong. */
const MAX_RESIDUAL = 0.05;

/**
 * Which unit the labels are in. Every hypothesis gets a scale; it's plausible when the labels
 * agree with it, the doors come out 0.6–1.0 m wide, and every room 0.6–15 m a side. Exactly
 * one plausible unit is used; otherwise the user picks, with the most plausible first.
 */
export function detectScale(
  hypotheses: readonly UnitHypothesis[],
  evidence: Evidence,
): ScaleDetection {
  const candidates = hypotheses.flatMap((h): UnitCandidate[] => {
    const fit = scaleFromSamples(h.samples);
    if (!fit) return [];
    const inRange = (meters: number, [min, max]: [number, number]) =>
      meters >= min && meters <= max;
    const doors =
      evidence.doorPixels.length === 0 ||
      inRange(median(evidence.doorPixels) * fit.metersPerPixel, DOOR_WIDTH);
    const rooms = evidence.rooms.every((r) =>
      r.pixels.every((px) => inRange(px * fit.metersPerPixel, ROOM_SIDE)),
    );
    return [{ ...fit, unit: h.unit, plausible: fit.residual <= MAX_RESIDUAL && doors && rooms }];
  });
  if (candidates.length === 0) return { status: 'none' };
  const plausible = candidates.filter((c) => c.plausible);
  if (plausible.length === 1) return { status: 'found', candidate: plausible[0]! };
  const ranked = candidates.toSorted(
    (a, b) => Number(b.plausible) - Number(a.plausible) || a.residual - b.residual,
  );
  return { status: 'ask', candidates: ranked };
}

/** The user measured one wall. */
export function scaleFromWallLength(pixels: number, meters: number): number {
  return meters / pixels;
}

/** The user knows an area, and which outline on the plan it covers: the shape fixes the rest. */
export function scaleFromArea(pixelArea: number, squareMeters: number): number {
  return Math.sqrt(squareMeters / pixelArea);
}

/**
 * An area plus one measured side over-determine the scale. The side sets it and the area checks
 * it: more than 5% apart means a wrong figure or a stretched image, so this also returns the
 * separate x and y scales that satisfy both (the side fixes its axis, the area their product).
 */
export function scaleFromAreaAndSide(input: {
  pixelArea: number;
  squareMeters: number;
  sidePixels: number;
  sideMeters: number;
  axis: 'x' | 'y';
}): {
  metersPerPixel: number;
  disagreement: number;
  consistent: boolean;
  stretched: { x: number; y: number };
} {
  const side = input.sideMeters / input.sidePixels;
  const fromArea = scaleFromArea(input.pixelArea, input.squareMeters);
  const disagreement = Math.abs(fromArea / side - 1);
  const other = input.squareMeters / input.pixelArea / side;
  return {
    metersPerPixel: side,
    disagreement,
    consistent: disagreement <= 0.05,
    stretched: input.axis === 'x' ? { x: side, y: other } : { x: other, y: side },
  };
}

/** A room's dimension label next to the room as drawn. */
export type LabelCheck = {
  labelId: string;
  roomId: string;
  text: string;
  /** What the label says, in meters. */
  stated: number[];
  /** The room's width and depth on the plan, paired with `stated`. */
  measured: number[];
  /** The worst side, as a fraction off. */
  error: number;
  agrees: boolean;
};

/**
 * Checks every room's dimension labels against the room as drawn at the current scale. Rooms are
 * outlined at the walls' center lines while labels usually give the inside, so a label up to a
 * wall's thickness short still agrees.
 */
export function checkRoomLabels(
  plan: Pick<Floorplan, 'rooms' | 'labels'>,
  tolerance = 0.03,
  wall = 0.2,
): LabelCheck[] {
  const labels = new Map(plan.labels.map((l) => [l.id, l]));
  return plan.rooms.flatMap((room) => {
    const { min, max } = bounds(room.boundary);
    const sides = [max.x - min.x, max.y - min.y];
    return room.labelTextIds.flatMap((id): LabelCheck[] => {
      const label = labels.get(id);
      const stated = label?.parsed?.meters;
      if (!label || !stated) return [];
      const off = (meters: number, side: number) => {
        if (meters > side) return meters / side - 1;
        if (meters < side - wall) return 1 - meters / (side - wall);
        return 0;
      };
      const pair = (order: number[]) => ({
        measured: stated.map((_, i) => order[i]!),
        error: Math.max(...stated.map((m, i) => off(m, order[i]!))),
      });
      const options =
        stated.length === 1 ? [[sides[0]!], [sides[1]!]] : [sides, sides.toReversed()];
      const best = options.map(pair).toSorted((a, b) => a.error - b.error)[0]!;
      return [
        {
          labelId: id,
          roomId: room.id,
          text: label.text,
          stated,
          ...best,
          agrees: best.error <= tolerance,
        },
      ];
    });
  });
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
