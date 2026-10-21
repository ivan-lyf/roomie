import { z } from 'zod';

/** A length in meters. All lengths are meters internally. */
export const Meters = z.number().finite().nonnegative();
export const PositiveMeters = z.number().finite().positive();

/** A point in 2D plan space: x to the right, y down the page. Meters. */
export const Vec2 = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type Vec2 = z.infer<typeof Vec2>;

/** Radians about the vertical axis. 0 = front faces plan +y (3D +Z). */
export const Radians = z.number().finite();
