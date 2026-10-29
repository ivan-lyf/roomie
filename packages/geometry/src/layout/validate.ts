import {
  type Category,
  FURNISHABLE,
  type Floorplan,
  type ObstacleKind,
  type Placement,
  type Room,
} from '@roomie/schema';
import { contains } from '../plan/polygon';
import { floorPolygon, roomAt, roomsBeside } from '../plan/rooms';
import {
  areaOutside,
  itemOutline,
  overlaps,
  type ProductFit,
  type Shape,
  shape,
  wallOutline,
} from './shapes';
import { doorZones, useZone } from './zones';

/** Shapes may overlap by this much, in meters, before it counts: they're drawn to the cm. */
export const OVERLAP_TOLERANCE = 0.01;

export type LayoutProblem = {
  code:
    | 'unknown_product'
    | 'wrong_room'
    | 'outside_room'
    | 'overlap'
    | 'blocks_door'
    | 'no_clearance';
  message: string;
  /** The placements involved first, then any wall, opening or obstacle in the way. */
  ids: string[];
};

/** What the plan has that furniture must keep clear of. */
export type LayoutPlan = Pick<Floorplan, 'walls' | 'openings' | 'rooms' | 'obstacles'>;

/** What an item is called in a problem's message. */
export const ITEM_NOUNS: Record<Category, string> = {
  bed: 'bed',
  sofa: 'sofa',
  armchair: 'armchair',
  coffee_table: 'coffee table',
  dining_table: 'dining table',
  dining_chair: 'chair',
  desk: 'desk',
  desk_chair: 'desk chair',
  shelving: 'shelf',
  wardrobe: 'wardrobe',
  dresser: 'dresser',
  nightstand: 'nightstand',
  tv_unit: 'TV unit',
  rug: 'rug',
  floor_lamp: 'floor lamp',
};

const OBSTACLE_NOUNS: Record<ObstacleKind, string> = {
  counter: 'counter',
  appliance: 'appliance',
  closet: 'closet',
  column: 'column',
  radiator: 'radiator',
  fireplace: 'fireplace',
  other: 'built-in',
};

/** What a use zone is for, in a problem's message. */
const ZONE_PURPOSE: Partial<Record<Category, string>> = {
  bed: 'to get in and out',
  sofa: 'for legroom',
  armchair: 'for legroom',
  desk: 'for a chair',
  dining_table: 'to pull out chairs',
  wardrobe: 'to open it',
  dresser: 'to open its drawers',
  shelving: 'to reach it',
  tv_unit: 'to reach it',
};

const CHAIRS: ReadonlySet<Category> = new Set(['dining_chair', 'desk_chair']);
const TABLES: ReadonlySet<Category> = new Set(['dining_table', 'desk']);

/** Whether two items may stand on the same floor: a rug under anything, a chair at a table. */
function mayShare(a: Category, b: Category): boolean {
  if (a === 'rug' || b === 'rug') return a !== b;
  return (CHAIRS.has(a) && TABLES.has(b)) || (CHAIRS.has(b) && TABLES.has(a));
}

type Item = { placement: Placement; product: ProductFit; outline: Shape; noun: string };
type Blocker = { id: string; shape: Shape; noun: string };

/** The plan's fixed shapes, worked out once per plan while the furniture moves. */
type Fixed = {
  floors: Map<string, Shape>;
  walls: Blocker[];
  obstacles: Blocker[];
  doors: { openingId: string; wallId: string; kind: string; parts: Shape[] }[];
};

/**
 * Fixed shapes by the plan's walls, kept while the plan's shapes stay the same objects: moving
 * furniture makes a new plan, but keeps its walls, openings, rooms and obstacles.
 */
const fixedShapes = new WeakMap<LayoutPlan['walls'], { plan: LayoutPlan; fixed: Fixed }>();

function fixed(plan: LayoutPlan): Fixed {
  const cached = fixedShapes.get(plan.walls);
  if (
    cached &&
    cached.plan.openings === plan.openings &&
    cached.plan.rooms === plan.rooms &&
    cached.plan.obstacles === plan.obstacles
  ) {
    return cached.fixed;
  }
  const kinds = new Map(plan.openings.map((o) => [o.id, o.kind]));
  const found: Fixed = {
    floors: new Map(plan.rooms.map((r) => [r.id, shape(floorPolygon(r.boundary, plan.walls))])),
    walls: plan.walls.map((w) => ({ id: w.id, shape: shape(wallOutline(w)), noun: 'a wall' })),
    obstacles: plan.obstacles.map((o) => ({
      id: o.id,
      shape: shape(o.polygon),
      noun: `the ${OBSTACLE_NOUNS[o.kind]}`,
    })),
    doors: doorZones(plan).map((z) => ({
      ...z,
      kind: kinds.get(z.openingId) === 'passage' ? 'open doorway' : 'door',
      parts: z.parts.map(shape),
    })),
  };
  fixedShapes.set(plan.walls, { plan, fixed: found });
  return found;
}

/**
 * Checks furniture against the plan and each other: every item known, standing in a furnishable
 * room and inside its floor, overlapping nothing it can't share space with, clear of doors and
 * their swings, and with the space it needs to be used. An empty list means the layout is valid;
 * each problem names the items and the plan elements involved.
 */
export function validateLayout(
  plan: LayoutPlan,
  furniture: readonly Placement[],
  products: ReadonlyMap<string, ProductFit>,
): LayoutProblem[] {
  const { floors, walls, obstacles, doors } = fixed(plan);
  const problems: LayoutProblem[] = [];
  const rooms = new Map(plan.rooms.map((r) => [r.id, r]));

  const items: Item[] = [];
  for (const placement of furniture) {
    const product = products.get(placement.articleNo);
    if (!product) {
      problems.push({
        code: 'unknown_product',
        message: `Product ${placement.articleNo} isn't in the catalog.`,
        ids: [placement.id],
      });
      continue;
    }
    const outline = shape(itemOutline(placement, product));
    items.push({ placement, product, outline, noun: ITEM_NOUNS[product.category] });
  }

  for (const item of items) {
    const { placement, noun } = item;
    const room = rooms.get(placement.roomId);
    const wrong = wrongRoom(plan.rooms, room, placement, noun);
    if (wrong) {
      problems.push({ code: 'wrong_room', message: wrong, ids: [placement.id] });
      continue;
    }
    const floor = floors.get(room!.id)!;
    if (areaOutside(item.outline.points, floor.points) > OVERLAP_TOLERANCE ** 2) {
      problems.push({
        code: 'outside_room',
        message: `The ${noun} sticks out of the ${room!.name}.`,
        ids: [placement.id],
      });
    }
  }

  items.forEach((item, i) => {
    for (const other of items.slice(i + 1)) {
      if (mayShare(item.product.category, other.product.category)) continue;
      if (!overlaps(item.outline, other.outline, OVERLAP_TOLERANCE)) continue;
      problems.push({
        code: 'overlap',
        message: `The ${item.noun} overlaps the ${other.noun}.`,
        ids: [item.placement.id, other.placement.id],
      });
    }
    for (const obstacle of obstacles) {
      if (!overlaps(item.outline, obstacle.shape, OVERLAP_TOLERANCE)) continue;
      problems.push({
        code: 'overlap',
        message: `The ${item.noun} overlaps ${obstacle.noun}.`,
        ids: [item.placement.id, obstacle.id],
      });
    }
  });

  for (const item of items) {
    if (item.product.category === 'rug') continue;
    for (const door of doors) {
      if (!door.parts.some((part) => overlaps(item.outline, part, OVERLAP_TOLERANCE))) continue;
      const wall = plan.walls.find((w) => w.id === door.wallId)!;
      const opening = plan.openings.find((o) => o.id === door.openingId)!;
      const beside = roomsBeside(wall, opening.offset + opening.width / 2, plan.rooms);
      const to = [beside.left, beside.right].find((r) => r && r.id !== item.placement.roomId);
      const from = rooms.get(item.placement.roomId)?.name ?? 'home';
      problems.push({
        code: 'blocks_door',
        message: to
          ? `The ${item.noun} blocks the ${door.kind} to the ${to.name}.`
          : `The ${item.noun} blocks a ${door.kind} out of the ${from}.`,
        ids: [item.placement.id, door.openingId],
      });
    }
  }

  for (const item of items) {
    const problem = clearance(item, items, walls, obstacles);
    if (problem) problems.push(problem);
  }
  return problems;
}

/** Why an item isn't standing in its own furnishable room, if it isn't. */
function wrongRoom(
  rooms: readonly Room[],
  room: Room | undefined,
  placement: Placement,
  noun: string,
): string | undefined {
  if (!room) return `The ${noun} is in a room that's no longer on the plan.`;
  if (!FURNISHABLE.has(room.roomType) || !room.furnishable) {
    return `The ${room.name} doesn't get furniture.`;
  }
  if (contains(room.boundary, placement)) return undefined;
  const actual = roomAt(rooms, placement);
  return actual
    ? `The ${noun} stands in the ${actual.name}, not the ${room.name}.`
    : `The ${noun} stands outside the home.`;
}

/** Whether an item has the space it needs to be used, and if not what's in the way. */
function clearance(
  item: Item,
  items: readonly Item[],
  walls: readonly Blocker[],
  obstacles: readonly Blocker[],
): LayoutProblem | undefined {
  const zone = useZone(item.placement, item.product);
  if (!zone) return undefined;
  const others: Blocker[] = [
    ...items
      .filter((o) => o !== item && !zone.allows.has(o.product.category))
      .map((o) => ({ id: o.placement.id, shape: o.outline, noun: `the ${o.noun}` })),
    ...walls,
    ...obstacles,
  ];
  const blocked = zone.parts.map((part) => {
    const s = shape(part);
    return others.filter((o) => overlaps(s, o.shape, OVERLAP_TOLERANCE));
  });
  const fails =
    zone.need === 'all' ? blocked.some((b) => b.length > 0) : blocked.every((b) => b.length > 0);
  if (!fails) return undefined;
  const inTheWay = [...new Map(blocked.flat().map((b) => [b.id, b])).values()];
  const cm = Math.round(zone.depth * 100);
  const where =
    item.product.category === 'bed'
      ? zone.need === 'all'
        ? 'along both sides'
        : 'along one side'
      : item.product.category === 'dining_table'
        ? 'on every side'
        : 'in front';
  const purpose = ZONE_PURPOSE[item.product.category] ?? 'to be used';
  const blocker = inTheWay[0]!.noun;
  return {
    code: 'no_clearance',
    message: `The ${item.noun} needs ${cm} cm clear ${where} ${purpose}: ${blocker} is in the way.`,
    ids: [item.placement.id, ...inTheWay.map((b) => b.id)],
  };
}
