import {
  type Category,
  FURNISHABLE,
  type Floorplan,
  type ObstacleKind,
  type Placement,
  type Room,
} from '@roomie/schema';
import { contains, signedArea } from '../plan/polygon';
import { edgeInsets, floorPolygon, roomAt, roomsBeside } from '../plan/rooms';
import { type Entrance, walkways } from './paths';
import {
  areaOutside,
  itemOutline,
  overlaps,
  type ProductFit,
  type Shape,
  shape,
  wallOutline,
} from './shapes';
import { DOOR_CLEARANCE, doorZones, zoneOf } from './zones';

/** Shapes may overlap by this much, in meters, before it counts: they're drawn to the cm. */
export const OVERLAP_TOLERANCE = 0.01;

export type LayoutProblem = {
  code:
    | 'unknown_product'
    | 'wrong_room'
    | 'outside_room'
    | 'overlap'
    | 'blocks_door'
    | 'no_clearance'
    | 'blocks_path';
  message: string;
  /** The placements involved first, then any wall, opening or obstacle in the way. */
  ids: string[];
  /** The room a walkway problem is in, since it may not name any item. */
  roomId?: string;
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
/** A way into a room, what to call it, and whether it's an open side rather than a doorway. */
type Way = Entrance & { name: string; open?: boolean };

/** The plan's fixed shapes, worked out once per plan while the furniture moves. */
type Fixed = {
  floors: Map<string, Shape>;
  walls: Blocker[];
  obstacles: Blocker[];
  doors: { openingId: string; wallId: string; kind: string; parts: Shape[] }[];
  /** Each room's way in, worked out when first needed, with what to call it. */
  entrances: Map<string, Way[]>;
  /** The entrances already cut off in the empty room: the plan's doing, not the furniture's. */
  cutOffEmpty: Map<string, Set<string>>;
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
    entrances: new Map(),
    cutOffEmpty: new Map(),
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
  /** `paths: false` skips the walkways, the slowest check, for a search to run first. */
  options: { paths?: boolean } = {},
): LayoutProblem[] {
  const fx = fixed(plan);
  const { floors, walls, obstacles, doors } = fx;
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

  for (const room of options.paths === false ? [] : plan.rooms) {
    const inRoom = items.filter((i) => i.placement.roomId === room.id);
    if (!inRoom.some((i) => i.product.category !== 'rug')) continue;
    problems.push(...pathProblems(plan, room, fx, inRoom, items, obstacles));
  }
  return problems;
}

/** A door or open doorway's clear zone in the room, and the strips along its open sides. */
function entrancesOf(plan: LayoutPlan, room: Room, fx: Fixed): Way[] {
  const known = fx.entrances.get(room.id);
  if (known) return known;
  const found: Way[] = [];
  const others = plan.rooms.filter((r) => r.id !== room.id);
  for (const door of fx.doors) {
    const wall = plan.walls.find((w) => w.id === door.wallId)!;
    const opening = plan.openings.find((o) => o.id === door.openingId)!;
    const beside = roomsBeside(wall, opening.offset + opening.width / 2, plan.rooms);
    const side = beside.left?.id === room.id ? 0 : beside.right?.id === room.id ? 1 : -1;
    if (side < 0) continue;
    const to = side === 0 ? beside.right : beside.left;
    const name = to
      ? `the ${door.kind} to the ${to.name}`
      : `a ${door.kind} out of the ${room.name}`;
    found.push({ id: door.openingId, region: door.parts[side]!.points, name });
  }
  // Sides with no wall, open to the next room.
  const floor = fx.floors.get(room.id)!.points;
  const insets = edgeInsets(room.boundary, plan.walls);
  const clockwise = signedArea(floor) > 0;
  floor.forEach((p, i) => {
    const q = floor[(i + 1) % floor.length]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (insets[i]! > 0 || length < DOOR_CLEARANCE) return;
    const d = { x: (q.x - p.x) / length, y: (q.y - p.y) / length };
    const n = clockwise ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
    const at = (v: { x: number; y: number }, by: number) => ({
      x: v.x + n.x * by,
      y: v.y + n.y * by,
    });
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const to = roomAt(others, at(mid, -0.1));
    // The floor just past the open side: reaching it is reaching the next room.
    found.push({
      id: `${room.id}:side${i}`,
      region: [p, q, at(q, -DOOR_CLEARANCE), at(p, -DOOR_CLEARANCE)],
      name: to ? `the open side to the ${to.name}` : `the open side of the ${room.name}`,
      open: true,
    });
  });
  fx.entrances.set(room.id, found);
  return found;
}

/** Whether 75 cm wide paths join a room's ways in, and come to each item's use zone. */
function pathProblems(
  plan: LayoutPlan,
  room: Room,
  fx: Fixed,
  inRoom: readonly Item[],
  items: readonly Item[],
  obstacles: readonly Blocker[],
): LayoutProblem[] {
  const floor = fx.floors.get(room.id)!.points;
  const entrances = entrancesOf(plan, room, fx);
  const built = obstacles.map((o) => o.shape.points);
  const beyond = entrances.filter((e) => e.open).map((e) => e.region);
  let empty = fx.cutOffEmpty.get(room.id);
  if (!empty) {
    empty = new Set(walkways(floor, beyond, built, entrances, []).cutOff);
    fx.cutOffEmpty.set(room.id, empty);
  }
  // A room too tight to walk through even empty is the plan's to fix, not the furniture's.
  if (empty.size === entrances.length) return [];
  const blockers = [
    ...items.filter((i) => i.product.category !== 'rug').map((i) => i.outline.points),
    ...built,
  ];
  const targets = inRoom.flatMap((i) => {
    const zone = zoneOf(i.placement, i.product);
    return zone ? [{ id: i.placement.id, parts: zone.parts }] : [];
  });
  const { cutOff, unreached } = walkways(floor, beyond, blockers, entrances, targets);
  const problems: LayoutProblem[] = [];
  for (const id of cutOff) {
    if (empty.has(id)) continue;
    const entrance = entrances.find((e) => e.id === id)!;
    const opening = plan.openings.some((o) => o.id === id);
    problems.push({
      code: 'blocks_path',
      message: `The way to ${entrance.name} is narrower than 75 cm.`,
      ids: opening ? [id] : [],
      roomId: room.id,
    });
  }
  for (const id of unreached) {
    const item = inRoom.find((i) => i.placement.id === id)!;
    problems.push({
      code: 'blocks_path',
      message: `There's no 75 cm path to the ${item.noun}.`,
      ids: [id],
      roomId: room.id,
    });
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
  const zone = zoneOf(item.placement, item.product);
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
  const nouns = [...new Set(inTheWay.map((b) => b.noun))];
  const blockers =
    nouns.length === 1
      ? `${nouns[0]} is`
      : `${nouns.slice(0, -1).join(', ')} and ${nouns.at(-1)} are`;
  return {
    code: 'no_clearance',
    message: `The ${item.noun} needs ${cm} cm clear ${where} ${purpose}: ${blockers} in the way.`,
    ids: [item.placement.id, ...inTheWay.map((b) => b.id)],
  };
}
