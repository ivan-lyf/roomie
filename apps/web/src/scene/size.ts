import type { Dims } from '@roomie/schema';

/** A measured bounding box size as [x, y, z] in meters. */
export type Size = [number, number, number];

/** Largest difference in meters between a measured size and listed dims (x = w, y = h, z = d). */
export function sizeError(size: Size, dims: Dims): number {
  return Math.max(
    Math.abs(size[0] - dims.w),
    Math.abs(size[1] - dims.h),
    Math.abs(size[2] - dims.d),
  );
}
