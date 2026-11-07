import {
  area,
  bounds,
  floorArea,
  floorPolygon,
  scaleFromArea,
  scaleFromWallLength,
} from '@roomie/geometry';
import {
  FURNISHABLE,
  type Floorplan,
  type RoomType,
  type Scale,
  type SourceUnit,
  type Vec2,
} from '@roomie/schema';

// The guided Check (docs/frontend-design.md §4.3): what the size question shows, and the two
// simplest ways to set the size when the plan's measurements didn't (PLAN.md §5.1). Pure, so the
// numbers are tested apart from the screen.

/** A wall or a room outline in image pixels, before the plan has a size or after. */
export type PixelPlan = {
  walls: { id: string; a: Vec2; b: Vec2; thickness: number }[];
  rooms: { id: string; polygon: Vec2[]; name: string; roomType?: RoomType }[];
};

/**
 * The plan's walls and rooms in image pixels: the traced plan scaled back by its size, or, for a
 * plan read but not yet sized, the reading's own draft (already in pixels).
 */
export function pixelPlan(plan: Floorplan): PixelPlan {
  const mpp = plan.scale?.metersPerPixel;
  if (mpp) {
    const px = (p: Vec2) => ({ x: p.x / mpp, y: p.y / mpp });
    return {
      walls: plan.walls.map((w) => ({
        id: w.id,
        a: px(w.a),
        b: px(w.b),
        thickness: w.thickness / mpp,
      })),
      rooms: plan.rooms.map((r) => ({
        id: r.id,
        polygon: r.boundary.map(px),
        name: r.name,
        roomType: r.roomType,
      })),
    };
  }
  const draft = plan.reading?.draft;
  return {
    walls: (draft?.walls ?? []).map((w) => ({ id: w.id, a: w.a, b: w.b, thickness: w.thickness })),
    rooms: (draft?.rooms ?? []).map((r, i) => ({
      id: r.id,
      polygon: r.polygon,
      name: r.label ?? `Room ${i + 1}`,
    })),
  };
}

/** The walls to ask about, longest first: long walls are the easiest to know and to measure. */
export function longWalls(walls: PixelPlan['walls'], count = 6): PixelPlan['walls'] {
  return walls.toSorted((u, v) => length(v) - length(u)).slice(0, count);
}

export const length = (w: { a: Vec2; b: Vec2 }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

/** What the size question shows: one room's sides and the whole home's floor area. */
export type SizeSummary = {
  room?: { name: string; width: number; depth: number };
  /** Floor area inside the walls of every room but balconies, in m². */
  homeArea: number;
};

/**
 * The sizes a person can judge (§4.3): a bedroom if there is one (everyone has a feel for a
 * bedroom), else the largest room we furnish, else the largest; and the home's floor area.
 */
export function sizeSummary(plan: Floorplan): SizeSummary {
  const byArea = plan.rooms.toSorted((u, v) => area(v.boundary) - area(u.boundary));
  const room =
    byArea.find((r) => r.roomType === 'bedroom') ??
    byArea.find((r) => FURNISHABLE.has(r.roomType)) ??
    byArea[0];
  const homeArea = plan.rooms
    .filter((r) => r.roomType !== 'balcony')
    .reduce((t, r) => t + floorArea(r.boundary, plan.walls), 0);
  if (!room) return { homeArea };
  return { room: { name: room.name, ...roomSides(plan, room.boundary) }, homeArea };
}

/** A room's two sides inside its walls, the longer first: "about 11′ × 10′". */
export function roomSides(plan: Floorplan, boundary: Vec2[]): { width: number; depth: number } {
  const { min, max } = bounds(floorPolygon(boundary, plan.walls));
  const [width, depth] = [max.x - min.x, max.y - min.y].sort((u, v) => v - u) as [number, number];
  return { width, depth };
}

/** The size from one wall the user knows the length of. */
export function scaleFromWall(
  wall: PixelPlan['walls'][number],
  meters: number,
  sourceUnit: SourceUnit,
  text: string,
): Scale {
  const pixels = length(wall);
  return {
    metersPerPixel: scaleFromWallLength(pixels, meters),
    sourceUnit,
    method: 'wall_length',
    inputs: { pixels, meters, text, line: [wall.a, wall.b], wallId: wall.id },
    residual: 0,
  };
}

/** Whether a listing's total area counts the balcony and closets. */
export type Includes = 'yes' | 'no' | 'unsure';

const EXTRA_TYPES = new Set<RoomType>(['balcony', 'closet']);
const EXTRA_NAMES = /balcon|terrace|patio|closet|\bwic\b|walk-in|storage|loggia/i;

const isExtra = (r: PixelPlan['rooms'][number]) =>
  r.roomType ? EXTRA_TYPES.has(r.roomType) : EXTRA_NAMES.test(r.name);
const isBalcony = (r: PixelPlan['rooms'][number]) =>
  r.roomType ? r.roomType === 'balcony' : /balcon|terrace|patio|loggia/i.test(r.name);

/**
 * The size from the home's total area as a listing gives it. Listings usually measure inside the
 * walls and leave the balcony out, so "not sure" counts closets but not balconies. None when the
 * plan has no rooms to measure.
 */
export function scaleFromTotal(
  plan: PixelPlan,
  squareMeters: number,
  includes: Includes,
  sourceUnit: SourceUnit,
  text: string,
): Scale | undefined {
  const counted = plan.rooms.filter((r) =>
    includes === 'yes' ? true : includes === 'no' ? !isExtra(r) : !isBalcony(r),
  );
  // Outlines run along the walls' center lines; the area people quote is inside them.
  const tolerance = Math.max(...plan.walls.map((w) => w.thickness), 2) / 2;
  const pixelArea = counted.reduce((t, r) => t + floorArea(r.polygon, plan.walls, tolerance), 0);
  if (pixelArea <= 0) return undefined;
  return {
    metersPerPixel: scaleFromArea(pixelArea, squareMeters),
    sourceUnit,
    method: 'area',
    inputs: {
      pixelArea,
      squareMeters,
      text,
      covers: 'inside',
      includes,
      rooms: counted.map((r) => r.id),
    },
    residual: 0,
  };
}
