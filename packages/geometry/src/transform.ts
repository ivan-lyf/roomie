import type { Dims, Vec2 } from '@roomie/schema';

/**
 * Map a point from a product's local floor space (x along width, y along
 * depth, front facing +y) to plan space. Matches Three.js `rotation.y`:
 * plan (x, y) is 3D (x, 0, y), so rotating by `rotation` sends local +Z to
 * plan (sin r, cos r).
 */
export function localToPlan(local: Vec2, origin: Vec2, rotation: number): Vec2 {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return {
    x: origin.x + local.x * c + local.y * s,
    y: origin.y - local.x * s + local.y * c,
  };
}

/** Unit vector in plan space that a product's front faces. */
export function frontDirection(rotation: number): Vec2 {
  return { x: Math.sin(rotation), y: Math.cos(rotation) };
}

/**
 * Corners of a product's floor footprint in plan space, in order:
 * back-left, back-right, front-right, front-left (in local x order).
 */
export function footprint(center: Vec2, dims: Dims, rotation: number): [Vec2, Vec2, Vec2, Vec2] {
  const hw = dims.w / 2;
  const hd = dims.d / 2;
  return [
    localToPlan({ x: -hw, y: -hd }, center, rotation),
    localToPlan({ x: hw, y: -hd }, center, rotation),
    localToPlan({ x: hw, y: hd }, center, rotation),
    localToPlan({ x: -hw, y: hd }, center, rotation),
  ];
}
