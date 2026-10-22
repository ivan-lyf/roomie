import { type Accessor, type Buffer, Document, type Material, type Mesh } from '@gltf-transform/core';
import type { Category, Dims, ProductShape } from '@roomie/schema';
import type { Vec3 } from './normalize';

type Tone = 'body' | 'soft' | 'accent' | 'light';

/** A box between two corners, or an upright cylinder, in model space (meters). */
type Part =
  | { kind: 'box'; min: Vec3; max: Vec3; tone: Tone }
  | { kind: 'cylinder'; x: number; z: number; radius: number; y0: number; y1: number; tone: Tone };

const box = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  tone: Tone = 'body',
): Part => ({ kind: 'box', min: [x0, y0, z0], max: [x1, y1, z1], tone });

const cylinder = (
  x: number,
  z: number,
  radius: number,
  y0: number,
  y1: number,
  tone: Tone = 'body',
): Part => ({ kind: 'cylinder', x, z, radius, y0, y1, tone });

/** Four square legs of side `s`, flush with the corners of a w × d footprint. */
function legs(w: number, d: number, s: number, top: number, tone: Tone = 'accent'): Part[] {
  const [W, D] = [w / 2, d / 2];
  return [
    box(-W, -W + s, 0, top, -D, -D + s, tone),
    box(W - s, W, 0, top, -D, -D + s, tone),
    box(-W, -W + s, 0, top, D - s, D, tone),
    box(W - s, W, 0, top, D - s, D, tone),
  ];
}

function seating({ w, d, h }: Dims): Part[] {
  const [W, D] = [w / 2, d / 2];
  const leg = Math.min(0.08, h * 0.1);
  const seat = Math.min(0.45, h * 0.55);
  const arm = Math.min(0.18, w * 0.12);
  const armTop = Math.min(h, Math.max(seat + 0.15, h * 0.7));
  const back = Math.min(0.25, d * 0.25);
  return [
    ...legs(w, d, 0.04, leg),
    box(-W, W, leg, seat, -D, D, 'soft'),
    box(-W, W, leg, h, -D, -D + back, 'soft'),
    box(-W, -W + arm, leg, armTop, -D, D, 'soft'),
    box(W - arm, W, leg, armTop, -D, D, 'soft'),
  ];
}

function bed({ w, d, h }: Dims): Part[] {
  const [W, D] = [w / 2, d / 2];
  const frame = Math.min(0.3, h * 0.4);
  const head = Math.min(0.08, d * 0.05);
  return [
    box(-W, W, 0, frame, -D, D),
    box(-W + 0.03, W - 0.03, frame, Math.min(frame + 0.2, h - 0.01), -D + head, D - 0.03, 'soft'),
    box(-W, W, 0, h, -D, -D + head),
  ];
}

function table({ w, d, h }: Dims, round: boolean): Part[] {
  const [W, D] = [w / 2, d / 2];
  const top = Math.min(0.04, h * 0.1);
  if (round) {
    return [
      cylinder(0, 0, W, h - top, h),
      cylinder(0, 0, Math.min(0.05, W * 0.15), 0.03, h - top, 'accent'),
      cylinder(0, 0, W * 0.55, 0, 0.03, 'accent'),
    ];
  }
  return [box(-W, W, h - top, h, -D, D), ...legs(w, d, Math.min(0.05, w * 0.08, d * 0.08), h - top)];
}

function chair({ w, d, h }: Dims): Part[] {
  const [W, D] = [w / 2, d / 2];
  const seat = Math.min(0.46, h * 0.55);
  return [
    ...legs(w, d, 0.035, seat - 0.05),
    box(-W, W, seat - 0.05, seat, -D, D, 'soft'),
    box(-W, W, seat, h, -D, -D + 0.05),
  ];
}

function officeChair({ w, d, h }: Dims): Part[] {
  const [W, D] = [w / 2, d / 2];
  const seat = Math.min(0.5, h * 0.45);
  return [
    box(-W, W, 0, 0.05, -0.03, 0.03, 'accent'),
    box(-0.03, 0.03, 0, 0.05, -D, D, 'accent'),
    cylinder(0, 0, 0.03, 0.05, seat - 0.08, 'accent'),
    box(-W * 0.75, W * 0.75, seat - 0.08, seat, -D * 0.75, D * 0.75, 'soft'),
    box(-W * 0.7, W * 0.7, seat, h, -D * 0.75, -D * 0.75 + 0.06, 'soft'),
  ];
}

function shelving({ w, d, h }: Dims): Part[] {
  const [W, D] = [w / 2, d / 2];
  const t = 0.018;
  const plinth = Math.min(0.06, h * 0.1);
  const parts = [
    box(-W, -W + t, 0, h, -D, D),
    box(W - t, W, 0, h, -D, D),
    box(-W, W, h - t, h, -D, D),
    box(-W, W, 0, plinth, -D, D),
    box(-W, W, 0, h, -D, -D + 0.008),
  ];
  const shelves = Math.max(1, Math.round(h / 0.38) - 1);
  for (let i = 1; i <= shelves; i++) {
    const y = plinth + ((h - plinth - t) * i) / (shelves + 1);
    parts.push(box(-W + t, W - t, y, y + t, -D + 0.008, D - 0.01));
  }
  return parts;
}

/** A closed cabinet with a grid of doors or drawer fronts, each with a handle, on short legs. */
function cabinet(
  { w, d, h }: Dims,
  { leg, rows, columns }: { leg: number; rows: number; columns: number },
): Part[] {
  const [W, D] = [w / 2, d / 2];
  const front = 0.012;
  const gap = 0.004;
  const parts = [box(-W, W, leg, h, -D, D - front), ...(leg > 0 ? legs(w, d - front, 0.04, leg) : [])];
  const [cw, rh] = [w / columns, (h - leg) / rows];
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < rows; r++) {
      const [x0, y0] = [-W + c * cw, leg + r * rh];
      parts.push(box(x0 + gap, x0 + cw - gap, y0 + gap, y0 + rh - gap, D - front, D - gap));
      const [hx, hy] = [x0 + cw / 2, y0 + rh * (rows > 1 ? 0.75 : 0.5)];
      const [hw, hh] = rows > 1 ? [Math.min(0.06, cw / 4), 0.008] : [0.008, Math.min(0.1, rh / 6)];
      parts.push(box(hx - hw, hx + hw, hy - hh, hy + hh, D - gap, D, 'accent'));
    }
  }
  return parts;
}

function floorLamp({ w, d, h }: Dims, round: boolean): Part[] {
  const [W, D] = [w / 2, d / 2];
  if (round) {
    return [
      cylinder(0, 0, W * 0.6, 0, 0.03, 'accent'),
      cylinder(0, 0, 0.012, 0.03, h * 0.8, 'accent'),
      cylinder(0, 0, W, h * 0.72, h, 'light'),
    ];
  }
  // Arm and arc lamps: a base at one end, the shade at the other.
  const r = Math.min(D, 0.15);
  const pole = -W + D;
  return [
    box(-W, -W + d, 0, 0.03, -D, D, 'accent'),
    cylinder(pole, 0, 0.012, 0.03, h * 0.85, 'accent'),
    box(pole, W - r, h * 0.85 - 0.02, h * 0.85, -0.01, 0.01, 'accent'),
    cylinder(W - r, 0, r, h * 0.7, h, 'light'),
  ];
}

const PARTS: Record<Category, (dims: Dims, round: boolean) => Part[]> = {
  sofa: seating,
  armchair: seating,
  bed,
  coffee_table: table,
  dining_table: table,
  desk: table,
  dining_chair: chair,
  desk_chair: officeChair,
  shelving,
  wardrobe: (dims) => cabinet(dims, { leg: 0, rows: 1, columns: Math.max(1, Math.round(dims.w / 0.5)) }),
  dresser: (dims) =>
    cabinet(dims, {
      leg: 0.08,
      rows: Math.max(2, Math.round((dims.h - 0.08) / 0.22)),
      columns: dims.w > 1 ? 2 : 1,
    }),
  nightstand: (dims, round) =>
    round ? [cylinder(0, 0, dims.w / 2, 0, dims.h)] : cabinet(dims, { leg: 0.1, rows: 2, columns: 1 }),
  tv_unit: (dims) =>
    cabinet(dims, { leg: 0.1, rows: 1, columns: Math.max(2, Math.round(dims.w / 0.6)) }),
  rug: ({ w, d, h }, round) =>
    round ? [cylinder(0, 0, w / 2, 0, h, 'soft')] : [box(-w / 2, w / 2, 0, h, -d / 2, d / 2, 'soft')],
  floor_lamp: floorLamp,
};

/** IKEA's color words, as display colors (sRGB). */
const COLORS: Record<string, string> = {
  white: '#ebe9e4',
  beige: '#d6c4a3',
  brown: '#7a5a3e',
  gray: '#9b9b97',
  black: '#2f2f2f',
  blue: '#5c7896',
  green: '#6c8a5d',
  yellow: '#d8b247',
  red: '#a6453a',
  turquoise: '#4e9898',
  orange: '#cf8a4c',
  pink: '#d7a6a2',
  multicolor: '#a89f91',
};
const NEUTRAL = '#b5b0a8';
const SHADE = '#f3eee4';

/** Colors for each tone from IKEA's color field, e.g. "beige, brown": body beige, legs brown. */
export function palette(color: string | null): Record<Tone, string> {
  const [first, second] = (color ?? '').split(',').map((c) => COLORS[c.trim().toLowerCase()]);
  const body = first ?? NEUTRAL;
  return { body, soft: body, accent: second ?? darker(body), light: SHADE };
}

/**
 * A simple stand-in model for a product without a usable IKEA model, at exactly its listed
 * size, with the origin at the bottom center and the front facing +Z.
 */
export function standInModel(
  category: Category,
  dims: Dims,
  shape: ProductShape,
  color: string | null,
): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const colors = palette(color);
  const geometry = { box: unitBox(doc, buffer), cylinder: unitCylinder(doc, buffer) };
  const materials = new Map<Tone, Material>();
  const meshes = new Map<string, Mesh>();
  const meshFor = (kind: Part['kind'], tone: Tone) => {
    const key = `${kind}:${tone}`;
    let mesh = meshes.get(key);
    if (!mesh) {
      let material = materials.get(tone);
      if (!material) {
        material = doc
          .createMaterial(tone)
          .setBaseColorFactor([...linear(colors[tone]), 1])
          .setRoughnessFactor(tone === 'accent' ? 0.5 : 0.85)
          .setMetallicFactor(0);
        materials.set(tone, material);
      }
      const { position, normal, indices } = geometry[kind];
      const prim = doc
        .createPrimitive()
        .setAttribute('POSITION', position)
        .setAttribute('NORMAL', normal)
        .setIndices(indices)
        .setMaterial(material);
      mesh = doc.createMesh(key).addPrimitive(prim);
      meshes.set(key, mesh);
    }
    return mesh;
  };

  const scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);
  for (const part of PARTS[category](dims, shape === 'round')) {
    const [center, size]: [Vec3, Vec3] =
      part.kind === 'box'
        ? [
            [0, 1, 2].map((i) => (part.min[i]! + part.max[i]!) / 2) as Vec3,
            [0, 1, 2].map((i) => part.max[i]! - part.min[i]!) as Vec3,
          ]
        : [
            [part.x, (part.y0 + part.y1) / 2, part.z],
            [part.radius * 2, part.y1 - part.y0, part.radius * 2],
          ];
    // Parts that come out empty on unusual sizes, like a mattress on a very low bed, are left out.
    if (size.some((s) => s <= 0)) continue;
    scene.addChild(
      doc.createNode().setMesh(meshFor(part.kind, part.tone)).setTranslation(center).setScale(size),
    );
  }
  return doc;
}

type Geometry = { position: Accessor; normal: Accessor; indices: Accessor };

/** A 1 m cube centered on the origin, with a normal per face. */
function unitBox(doc: Document, buffer: Buffer): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
      const start = positions.length / 3;
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const p: Vec3 = [0, 0, 0];
        p[axis] = sign * 0.5;
        p[u] = a * 0.5;
        p[v] = b * 0.5;
        positions.push(...p);
        const n: Vec3 = [0, 0, 0];
        n[axis] = sign;
        normals.push(...n);
      }
      // Counter-clockwise when seen from outside.
      indices.push(
        ...(sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((i) => start + i),
      );
    }
  }
  return accessors(doc, buffer, positions, normals, indices);
}

/** An upright cylinder of diameter 1 m and height 1 m centered on the origin, with caps. */
function unitCylinder(doc: Document, buffer: Buffer, segments = 24): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const [x, z] = [Math.cos(a) * 0.5, Math.sin(a) * 0.5];
    positions.push(x, -0.5, z, x, 0.5, z);
    normals.push(x * 2, 0, z * 2, x * 2, 0, z * 2);
  }
  for (let i = 0; i < segments; i++) {
    const [b0, t0, b1, t1] = [2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3];
    indices.push(b0, t0, t1, b0, t1, b1);
  }
  for (const y of [-0.5, 0.5]) {
    const center = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, Math.sign(y), 0);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * 0.5, y, Math.sin(a) * 0.5);
      normals.push(0, Math.sign(y), 0);
    }
    for (let i = 0; i < segments; i++) {
      const [p, q] = [center + 1 + i, center + 2 + i];
      indices.push(...(y > 0 ? [center, q, p] : [center, p, q]));
    }
  }
  return accessors(doc, buffer, positions, normals, indices);
}

function accessors(
  doc: Document,
  buffer: Buffer,
  positions: number[],
  normals: number[],
  indices: number[],
): Geometry {
  return {
    position: doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer),
    normal: doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer),
    indices: doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer),
  };
}

function darker(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((n >> shift) & 255) * 0.55);
  return `#${[16, 8, 0].map((s) => channel(s).toString(16).padStart(2, '0')).join('')}`;
}

/** sRGB hex to the linear values glTF's baseColorFactor expects. */
function linear(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [16, 8, 0].map((shift) => {
    const c = ((n >> shift) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}
