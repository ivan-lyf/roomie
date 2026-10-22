import type { Vec2 } from '@roomie/schema';
import { BufferGeometry, Color, Float32BufferAttribute } from 'three';

type Vec3 = [number, number, number];

/** The faces of a box standing on the plan: its two sides, top, bottom and two ends. */
export type BoxFace = 'left' | 'right' | 'top' | 'bottom' | 'start' | 'end';

/**
 * A box standing on the plan: `length` along `direction` (a unit vector on the plan), `width`
 * across it, from `bottom` to `top` above the floor. Its left side is on the left of
 * `direction`, as seen on the plan.
 */
export type PlanBox = {
  center: Vec2;
  direction: Vec2;
  length: number;
  width: number;
  bottom: number;
  top: number;
};

/**
 * Builds one geometry from many boxes, with a color per face, so a whole set of walls is a
 * single draw call. Plan (x, y) at height h is 3D (x, h, y).
 */
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  /** A quad from four corners in order around it, wound to face `normal`. */
  quad(corners: [Vec3, Vec3, Vec3, Vec3], normal: Vec3, color: Color) {
    const [a, b, c] = corners;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const facing =
      (u[1]! * v[2]! - u[2]! * v[1]!) * normal[0] +
      (u[2]! * v[0]! - u[0]! * v[2]!) * normal[1] +
      (u[0]! * v[1]! - u[1]! * v[0]!) * normal[2];
    const ordered = facing >= 0 ? corners : corners.toReversed();
    const first = this.positions.length / 3;
    for (const p of ordered) {
      this.positions.push(...p);
      this.normals.push(...normal);
      this.colors.push(color.r, color.g, color.b);
    }
    this.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  /** A box, with each face in the color `color` gives it, or left out when that's undefined. */
  box(box: PlanBox, color: (face: BoxFace) => Color | undefined) {
    const { center, direction: d, length, width, bottom, top } = box;
    // The left normal on the plan, where y points down the page.
    const n = { x: d.y, y: -d.x };
    const at = (along: number, across: number, height: number): Vec3 => [
      center.x + d.x * along + n.x * across,
      height,
      center.y + d.y * along + n.y * across,
    ];
    const [l, w] = [length / 2, width / 2];
    const faces: [BoxFace, [Vec3, Vec3, Vec3, Vec3], Vec3][] = [
      ['left', [at(-l, w, bottom), at(l, w, bottom), at(l, w, top), at(-l, w, top)], [n.x, 0, n.y]],
      [
        'right',
        [at(-l, -w, bottom), at(l, -w, bottom), at(l, -w, top), at(-l, -w, top)],
        [-n.x, 0, -n.y],
      ],
      ['top', [at(-l, w, top), at(l, w, top), at(l, -w, top), at(-l, -w, top)], [0, 1, 0]],
      [
        'bottom',
        [at(-l, w, bottom), at(l, w, bottom), at(l, -w, bottom), at(-l, -w, bottom)],
        [0, -1, 0],
      ],
      [
        'start',
        [at(-l, w, bottom), at(-l, -w, bottom), at(-l, -w, top), at(-l, w, top)],
        [-d.x, 0, -d.y],
      ],
      ['end', [at(l, w, bottom), at(l, -w, bottom), at(l, -w, top), at(l, w, top)], [d.x, 0, d.y]],
    ];
    for (const [face, corners, normal] of faces) {
      const c = color(face);
      if (c) this.quad(corners, normal, c);
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    return geometry;
  }
}
