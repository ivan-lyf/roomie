import type { Category, Placement, Vec2 } from '@roomie/schema';
import { signedArea } from '../plan/polygon';
import { edgeInsets, floorPolygon } from '../plan/rooms';
import { itemOutline, overlaps, type ProductFit, shape } from './shapes';
import { doorZones } from './zones';
import { type LayoutPlan, OVERLAP_TOLERANCE } from './validate';

/** An item this close to a wall, in meters, moves flush against it. */
export const SNAP_DISTANCE = 0.15;

/** Items that stand out in the room rather than against a wall. */
const FREE_STANDING: ReadonlySet<Category> = new Set([
  'rug',
  'coffee_table',
  'dining_chair',
  'desk_chair',
]);

const QUARTER = Math.PI / 2;

/** A rotation turned by `by` radians, kept within (-π, π]. */
export function turn(rotation: number, by: number): number {
  const r = (rotation + by) % (2 * Math.PI);
  if (r > Math.PI) return r - 2 * Math.PI;
  if (r <= -Math.PI) return r + 2 * Math.PI;
  return r;
}

/** A wall face along a room's floor: a point on it, its direction, length, and the way in. */
type Face = { p: Vec2; d: Vec2; length: number; inward: Vec2 };

function wallFaces(plan: LayoutPlan, roomId: string): Face[] {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const floor = floorPolygon(room.boundary, plan.walls);
  const insets = edgeInsets(room.boundary, plan.walls);
  const faces: Face[] = [];
  floor.forEach((p, i) => {
    if (insets[i]! <= 0) return;
    const q = floor[(i + 1) % floor.length]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length < 1e-9) return;
    const d = { x: (q.x - p.x) / length, y: (q.y - p.y) / length };
    faces.push({ p, d, length, inward: { x: 0, y: 0 } });
  });
  // The way in is to the right of each face as drawn when the floor runs clockwise.
  const clockwise = signedArea(floor) > 0;
  for (const f of faces) {
    f.inward = clockwise ? { x: -f.d.y, y: f.d.x } : { x: f.d.y, y: -f.d.x };
  }
  return faces;
}

const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;

/** How far an item reaches from its center along a direction. */
function reach(product: ProductFit, rotation: number, n: Vec2): number {
  if (product.shape === 'round') return product.dims.w / 2;
  const across = { x: Math.cos(rotation), y: -Math.sin(rotation) };
  const front = { x: Math.sin(rotation), y: Math.cos(rotation) };
  return (
    (Math.abs(dot(across, n)) * product.dims.w) / 2 + (Math.abs(dot(front, n)) * product.dims.d) / 2
  );
}

/**
 * How far an item is from a wall face, in meters (less than 0 when it's through it), if the
 * item is beside that face at all: its center on the room's side, and alongside the face.
 */
function gap(at: Vec2, product: ProductFit, rotation: number, face: Face): number | undefined {
  const rel = { x: at.x - face.p.x, y: at.y - face.p.y };
  const inside = dot(rel, face.inward);
  if (inside <= 0) return undefined;
  const along = dot(rel, face.d);
  const side = reach(product, rotation, face.d);
  if (along + side <= 0 || along - side >= face.length) return undefined;
  return inside - reach(product, rotation, face.inward);
}

/**
 * Where an item dragged to `placement` settles: within 15 cm of a wall of its room, it turns
 * square to the wall (its back to it, or a side; never its front) and moves flush; then within
 * 15 cm of a second wall, it slides along the first into the corner. An item that would block a
 * door only once snapped stays where it was dropped.
 */
export function snapPlacement(
  placement: Pick<Placement, 'x' | 'y' | 'rotation' | 'roomId'>,
  product: ProductFit,
  plan: LayoutPlan,
): Pick<Placement, 'x' | 'y' | 'rotation'> {
  const dropped = { x: placement.x, y: placement.y, rotation: placement.rotation };
  if (FREE_STANDING.has(product.category)) return dropped;
  const faces = wallFaces(plan, placement.roomId);

  let wall: Face | undefined;
  let nearest = SNAP_DISTANCE;
  for (const face of faces) {
    const g = gap(placement, product, placement.rotation, face);
    if (g !== undefined && g <= nearest) [wall, nearest] = [face, g];
  }
  if (!wall) return dropped;

  // Square to the wall: back to it, or a side, whichever is nearest; a front to it turns round.
  let rotation = placement.rotation;
  if (product.shape !== 'round') {
    const facing = Math.atan2(wall.inward.x, wall.inward.y);
    let quarters = Math.round(turn(placement.rotation, -facing) / QUARTER);
    if (Math.abs(quarters) === 2) quarters = 0;
    rotation = turn(facing, quarters * QUARTER);
  }
  const depth = dot({ x: placement.x - wall.p.x, y: placement.y - wall.p.y }, wall.inward);
  const off = reach(product, rotation, wall.inward) - depth;
  let at = { x: placement.x + wall.inward.x * off, y: placement.y + wall.inward.y * off };

  // Into a corner: slide along the wall to the nearest other wall within reach.
  let corner: Face | undefined;
  let closest = SNAP_DISTANCE;
  for (const face of faces) {
    if (face === wall || Math.abs(dot(face.d, wall.d)) > 0.5) continue;
    const g = gap(at, product, rotation, face);
    if (g !== undefined && g <= closest) [corner, closest] = [face, g];
  }
  if (corner) {
    const slide = -closest / dot(wall.d, corner.inward);
    at = { x: at.x + wall.d.x * slide, y: at.y + wall.d.y * slide };
  }

  const snapped = { ...at, rotation };
  const blocks = (p: Pick<Placement, 'x' | 'y' | 'rotation'>) => {
    const outline = shape(itemOutline(p, product));
    return doorZones(plan).some((zone) =>
      zone.parts.some((part) => overlaps(outline, shape(part), OVERLAP_TOLERANCE)),
    );
  };
  return blocks(snapped) && !blocks(dropped) ? dropped : snapped;
}
