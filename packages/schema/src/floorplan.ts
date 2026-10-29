import { z } from 'zod';
import { Meters, PositiveMeters, Vec2 } from './geometry';
import { Placement } from './layout';

// Plan space is meters, with the origin at the top-left of the source image and x/y along its
// axes: a pixel times `Scale.metersPerPixel` is a point in plan space (see CLAUDE.md).

/** Furnishable room types first, then the ones that are rendered but left empty (PLAN.md §3). */
export const RoomType = z.enum([
  'living_room',
  'bedroom',
  'studio',
  'dining_area',
  'den_office',
  'kitchen',
  'bathroom',
  'hallway',
  'closet',
  'laundry',
  'balcony',
  'other',
]);
export type RoomType = z.infer<typeof RoomType>;

/** The room types that get furniture. */
export const FURNISHABLE: ReadonlySet<RoomType> = new Set([
  'living_room',
  'bedroom',
  'studio',
  'dining_area',
  'den_office',
]);

/**
 * A wall's center line from `a` to `b`. Walls belong to the floorplan, not to a room: a wall
 * between two rooms is stored once. Its height comes from the ceilings of the rooms it bounds.
 */
export const Wall = z.object({
  id: z.string().min(1),
  a: Vec2,
  b: Vec2,
  thickness: PositiveMeters,
});
export type Wall = z.infer<typeof Wall>;

/**
 * Door swing, relative to the wall's direction from `a` to `b`.
 * `hinge`: which end of the opening the hinge is on.
 * `side`: which side of the wall the door swings into (left/right of a→b).
 */
export const DoorSwing = z.object({
  hinge: z.enum(['start', 'end']),
  side: z.enum(['left', 'right']),
});
export type DoorSwing = z.infer<typeof DoorSwing>;

/** A passage is an opening with no door, like an arch into a kitchen. */
export const OpeningKind = z.enum(['door', 'window', 'passage']);
export type OpeningKind = z.infer<typeof OpeningKind>;

export const Opening = z.object({
  id: z.string().min(1),
  wallId: z.string().min(1),
  kind: OpeningKind,
  /** Distance from the wall's `a` endpoint to the start of the opening. */
  offset: Meters,
  width: PositiveMeters,
  height: PositiveMeters,
  /** Windows only: height of the bottom edge above the floor. */
  sillHeight: Meters.optional(),
  /** Doors only. */
  swing: DoorSwing.optional(),
});
export type Opening = z.infer<typeof Opening>;

/** Fixed things drawn on the plan that furniture must avoid. */
export const ObstacleKind = z.enum([
  'counter',
  'appliance',
  'closet',
  'column',
  'radiator',
  'fireplace',
  'other',
]);
export type ObstacleKind = z.infer<typeof ObstacleKind>;

export const Obstacle = z.object({
  id: z.string().min(1),
  kind: ObstacleKind,
  polygon: z.array(Vec2).min(3),
  /** Defaults by kind when the plan doesn't say. */
  height: PositiveMeters.optional(),
});
export type Obstacle = z.infer<typeof Obstacle>;

/** A rectangle in image pixels: top-left corner, width and height. */
export const PixelBox = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().nonnegative(),
  h: z.number().finite().nonnegative(),
});
export type PixelBox = z.infer<typeof PixelBox>;

export const PlanTextKind = z.enum(['room_label', 'dimension', 'area', 'ceiling', 'other']);
export type PlanTextKind = z.infer<typeof PlanTextKind>;

/**
 * A piece of text read from the plan image. Kept even after it's used, so a wrong room type or
 * scale can be traced back to the label that caused it.
 */
export const PlanText = z.object({
  id: z.string().min(1),
  text: z.string(),
  /** Where it is on the source image, so the editor can draw it in place. */
  bbox: PixelBox,
  kind: PlanTextKind,
  parsed: z
    .object({
      /** One length, or two for "12' x 10'"; a ceiling label's height. */
      meters: z.array(PositiveMeters).min(1).max(2).optional(),
      squareMeters: PositiveMeters.optional(),
      roomType: RoomType.optional(),
    })
    .optional(),
});
export type PlanText = z.infer<typeof PlanText>;

/** The unit the plan's labels use; `none` when it has no dimension labels. */
export const SourceUnit = z.enum(['imperial', 'metric_m', 'metric_cm', 'metric_mm', 'none']);
export type SourceUnit = z.infer<typeof SourceUnit>;

export const ScaleMethod = z.enum(['labels', 'wall_length', 'area', 'area_and_side']);
export type ScaleMethod = z.infer<typeof ScaleMethod>;

/** One scale for the whole image, set before anything is measured (PLAN.md §5.1). */
export const Scale = z.object({
  metersPerPixel: z.number().finite().positive(),
  sourceUnit: SourceUnit,
  method: ScaleMethod,
  /** What the scale was worked out from: the labels used, or the user's measurements. */
  inputs: z.record(z.string(), z.unknown()),
  /** How far the other labels or inputs disagree with this scale, as a fraction. */
  residual: z.number().finite().nonnegative(),
});
export type Scale = z.infer<typeof Scale>;

// Placeholder set; the plan calls for 3–5 floor textures.
export const FloorMaterial = z.enum(['light_oak', 'dark_oak', 'concrete', 'carpet', 'tile']);
export type FloorMaterial = z.infer<typeof FloorMaterial>;

export const Materials = z.object({
  wallColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  floor: FloorMaterial,
  light: z.object({
    /** Color temperature in kelvin. */
    warmthK: z.number().min(1800).max(6500),
    intensity: z.number().min(0).max(1),
  }),
});
export type Materials = z.infer<typeof Materials>;

/** A room's own materials: each one set here overrides the home's. */
export const MaterialsOverride = Materials.partial();
export type MaterialsOverride = z.infer<typeof MaterialsOverride>;

/** A room is a polygon over the floorplan; its walls are the ones along its boundary. */
export const Room = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  roomType: RoomType,
  boundary: z.array(Vec2).min(3),
  /** The plan text that named or measured this room. */
  labelTextIds: z.array(z.string()),
  /** Defaults from the room type; the user can leave a room unfurnished. */
  furnishable: z.boolean(),
  /** Overrides the floorplan's ceiling height (lofts, dropped ceilings). */
  ceilingHeight: PositiveMeters.optional(),
  /** Overrides some or all of the floorplan's materials. */
  materials: MaterialsOverride.optional(),
});
export type Room = z.infer<typeof Room>;

/** `needs_calibration`: read, but the plan had no usable dimension labels to set the scale. */
export const FloorplanStatus = z.enum(['uploaded', 'needs_calibration', 'ready']);
export type FloorplanStatus = z.infer<typeof FloorplanStatus>;

export const CeilingHeightSource = z.enum(['user', 'plan', 'default']);
export type CeilingHeightSource = z.infer<typeof CeilingHeightSource>;

/** The uploaded plan image, in file storage. */
export const PlanImage = z.object({
  key: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PlanImage = z.infer<typeof PlanImage>;

// The plan reader's work (PLAN.md §5): what a vision model read off the image, in image pixels,
// and the same tidied up. Plan space is meters, so the draft is converted only once the plan has
// a scale (from its labels, or from the user).

/** A door's swing as drawn: the jamb it's hinged on, and a point on the side it opens into. */
export const RawSwing = z.object({ hinge: Vec2, toward: Vec2 });
export type RawSwing = z.infer<typeof RawSwing>;

/** A plan as the reader returned it, in image pixels, before any tidying. */
export const RawPlan = z.object({
  /** Center lines, with the thickness across. */
  walls: z.array(z.object({ a: Vec2, b: Vec2, thickness: z.number().finite().nonnegative() })),
  /** From one jamb to the other, along the wall. */
  openings: z.array(z.object({ kind: OpeningKind, a: Vec2, b: Vec2, swing: RawSwing.optional() })),
  rooms: z.array(
    z.object({
      polygon: z.array(Vec2).min(3),
      /** The text the reader saw naming it. */
      label: z.string().optional(),
      /** The reader's guess; the plan's own labels win. */
      type: RoomType.optional(),
    }),
  ),
  obstacles: z.array(z.object({ kind: ObstacleKind, polygon: z.array(Vec2).min(3) })),
  /** Every piece of text, one line each. */
  texts: z.array(z.object({ text: z.string(), bbox: PixelBox })),
});
export type RawPlan = z.infer<typeof RawPlan>;

/**
 * A tidied draft: walls joined at corners, openings placed on their walls, rooms on the walls'
 * center lines. The same shapes as a floorplan's, but in image pixels.
 */
export const PlanDraft = z.object({
  walls: z.array(Wall),
  openings: z.array(
    Opening.pick({ id: true, wallId: true, kind: true, offset: true, width: true, swing: true }),
  ),
  rooms: z.array(
    z.object({
      id: z.string().min(1),
      polygon: z.array(Vec2).min(3),
      label: z.string().optional(),
      type: RoomType.optional(),
    }),
  ),
  obstacles: z.array(Obstacle.omit({ height: true })),
  texts: z.array(z.object({ id: z.string().min(1), text: z.string(), bbox: PixelBox })),
});
export type PlanDraft = z.infer<typeof PlanDraft>;

/** A scale the plan's labels could give, when they fit more than one unit: the user picks. */
export const ScaleCandidate = Scale.extend({
  /** Doors, rooms and labels all make sense at this scale. */
  plausible: z.boolean(),
});
export type ScaleCandidate = z.infer<typeof ScaleCandidate>;

/** What the plan reader returned, kept for debugging and evaluation. */
export const PlanReading = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  durationMs: z.number().nonnegative(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .optional(),
  /** The reader's own answer, as it came. */
  raw: z.unknown(),
  draft: PlanDraft,
  scaleCandidates: z.array(ScaleCandidate).default([]),
});
export type PlanReading = z.infer<typeof PlanReading>;

/** A single-floor home: from one room or a studio to a multi-room apartment. */
export const Floorplan = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  status: FloorplanStatus,
  image: PlanImage.nullable(),
  walls: z.array(Wall),
  openings: z.array(Opening),
  rooms: z.array(Room),
  obstacles: z.array(Obstacle),
  labels: z.array(PlanText),
  scale: Scale.nullable(),
  ceilingHeight: PositiveMeters,
  ceilingHeightSource: CeilingHeightSource,
  /** The whole home's materials; rooms can override them. */
  materials: Materials,
  reading: PlanReading.nullable(),
  /**
   * The furniture in the home now, as the user left it. Generated layouts stay as they were
   * logged; a chosen one is copied here, and `furnishedFrom` says which.
   */
  furniture: z.array(Placement).default([]),
  furnishedFrom: z.uuid().nullable().default(null),
  /** Time spent correcting the plan in the editor, to check PLAN.md's correction targets. */
  editSeconds: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Floorplan = z.infer<typeof Floorplan>;

/** A floorplan in a list of them. */
export const FloorplanSummary = Floorplan.pick({
  id: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});
export type FloorplanSummary = z.infer<typeof FloorplanSummary>;

/**
 * What a save can change: everything but the identity, the uploaded image, what the reader
 * returned, the layout the furniture came from, and the timestamps, which the server keeps.
 */
export const FloorplanEdit = Floorplan.omit({
  id: true,
  image: true,
  reading: true,
  furnishedFrom: true,
  createdAt: true,
  updatedAt: true,
});
export type FloorplanEdit = z.infer<typeof FloorplanEdit>;
