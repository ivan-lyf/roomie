import { z } from 'zod';
import { Meters, PositiveMeters, Vec2 } from './geometry';

export const RoomType = z.enum(['living_room', 'bedroom', 'studio']);
export type RoomType = z.infer<typeof RoomType>;

export const Wall = z.object({
  id: z.string().min(1),
  a: Vec2,
  b: Vec2,
  thickness: PositiveMeters,
  height: PositiveMeters,
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

export const Opening = z.object({
  id: z.string().min(1),
  wallId: z.string().min(1),
  kind: z.enum(['door', 'window']),
  /** Distance from the wall's `a` endpoint to the start of the opening. */
  offset: Meters,
  width: PositiveMeters,
  height: PositiveMeters,
  sillHeight: Meters.optional(),
  swing: DoorSwing.optional(),
});
export type Opening = z.infer<typeof Opening>;

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

export const Room = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  roomType: RoomType,
  walls: z.array(Wall),
  openings: z.array(Opening),
  materials: Materials,
  sourceImageUrl: z.url().nullable(),
  createdAt: z.coerce.date(),
});
export type Room = z.infer<typeof Room>;
