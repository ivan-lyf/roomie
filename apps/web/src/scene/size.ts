import type { Dims, ProductShape } from '@roomie/schema';

/** A measured bounding box size as [x, y, z] in meters. */
export type Size = [number, number, number];

/**
 * Largest difference in meters between a measured size and listed dims (x = w, y = h, z = d).
 * A round product only has to reach its diameter on its wider side.
 */
export function sizeError(size: Size, dims: Dims, shape: ProductShape = 'rect'): number {
  const height = Math.abs(size[1] - dims.h);
  if (shape === 'round') return Math.max(Math.abs(Math.max(size[0], size[2]) - dims.w), height);
  return Math.max(Math.abs(size[0] - dims.w), height, Math.abs(size[2] - dims.d));
}
