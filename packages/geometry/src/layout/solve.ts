import type { Category, Placement, Relation, RoomIntent, Vec2 } from '@roomie/schema';
import { bounds, contains } from '../plan/polygon';
import { type Face, type RoomContext, roomContext } from './room';
import { type Piece, type Scored, type ScoredProduct, scoreRoom, VIEWING_DISTANCE } from './score';
import { reach } from './shapes';
import { turn } from './snap';
import { ITEM_NOUNS, type LayoutPlan, validateLayout } from './validate';

// The solver (PLAN.md M4): turns one room's intent into positions. Items go in one at a time,
// anchors first, each at the best-scoring spot that keeps the room valid; a seeded local search
// then moves them, with the items hanging off them, while the score rises. Validity always comes
// from validateLayout, so the solver can't disagree with the rules.

/** The order items go in: anchors before what hangs off them, rugs last. */
const ORDER: Category[] = [
  'bed',
  'sofa',
  'dining_table',
  'desk',
  'wardrobe',
  'dresser',
  'tv_unit',
  'shelving',
  'armchair',
  'coffee_table',
  'nightstand',
  'dining_chair',
  'desk_chair',
  'floor_lamp',
  'rug',
];

/** Items that go against a wall; the rest may also stand out on the floor. */
const AGAINST_WALL: ReadonlySet<Category> = new Set([
  'bed',
  'sofa',
  'wardrobe',
  'dresser',
  'shelving',
  'tv_unit',
  'desk',
  'nightstand',
  'floor_lamp',
  'armchair',
]);
const FREE_STANDING: ReadonlySet<Category> = new Set([
  'coffee_table',
  'armchair',
  'dining_table',
  'rug',
  'floor_lamp',
  'dining_chair',
  'desk_chair',
  'sofa',
]);

/** How far apart wall spots and floor spots are tried, in meters. */
const WALL_STEP = 0.1;
const FLOOR_STEP = 0.3;
/** How many valid spots the seeded draw picks among. */
const DRAW = 3;
/** How much worse than the best a spot can score and still be drawn, roughly. */
const DRAW_SPREAD = 0.03;
/** A spot this close to one to avoid, in meters, and facing the same way, counts as that one. */
const STAY = 0.5;

export type SolveOptions = {
  seed: number;
  /** Local search moves to try. */
  steps?: number;
  /**
   * Furniture already standing in other rooms, which this room mustn't make invalid: rooms open
   * to each other share walkways. Their ids must differ from this room's refs.
   */
  others?: readonly Placement[];
  /**
   * Where items stand now, by ref, which they must leave: rearranging a room means its main
   * pieces move (M5).
   */
  avoid?: readonly Pick<Placement, 'id' | 'x' | 'y' | 'rotation'>[];
  /**
   * Every item gets a valid spot if there's one anywhere: one that hangs off another goes
   * elsewhere when there's no room by it, rather than being left out. For items the room
   * already has, which no repair can swap for smaller ones.
   */
  placeAll?: boolean;
};

export type RoomSolution = {
  roomId: string;
  /** Placements by ref: their ids are the intent's refs. */
  placements: Placement[];
  /** Items with no valid spot, and why. */
  unplaced: { ref: string; reason: string }[];
} & Scored;

/** A small, fast, seeded random number generator (mulberry32): the same seed, the same layout. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Spot = Pick<Placement, 'x' | 'y' | 'rotation'>;
type Item = { ref: string; articleNo: string; product: ScoredProduct };

const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const facing = (inward: Vec2) => Math.atan2(inward.x, inward.y);
const frontOf = (rotation: number) => ({ x: Math.sin(rotation), y: Math.cos(rotation) });
const leftOf = (rotation: number) => ({ x: Math.cos(rotation), y: -Math.sin(rotation) });

/** Spots with the item's back against each wall face, every 10 cm, corners included. */
function wallSpots(item: Item, ctx: RoomContext, sideways: boolean): Spot[] {
  const spots: Spot[] = [];
  const turns = sideways ? [0, Math.PI / 2, -Math.PI / 2] : [0];
  for (const face of ctx.faces) {
    for (const t of turns) {
      const rotation = turn(facing(face.inward), t);
      const half = reach(item.product, rotation, face.d);
      const depth = reach(item.product, rotation, face.inward);
      if (face.length < 2 * half) continue;
      const along: number[] = [];
      for (let s = half; s <= face.length - half + 1e-9; s += WALL_STEP) along.push(s);
      along.push(face.length - half);
      for (const s of along) {
        spots.push({
          x: face.p.x + face.d.x * s + face.inward.x * depth,
          y: face.p.y + face.d.y * s + face.inward.y * depth,
          rotation,
        });
      }
    }
  }
  return spots;
}

/** How much a wall to put the TV on, straight ahead of the sofa, counts toward the sofa's spot. */
const LOOK_AHEAD = 0.25;

/**
 * The wall a seat looks straight at, if any: where its line of sight meets the face, and how far
 * from the seat. Only a face it looks at squarely counts, not one at a slant.
 */
function wallAhead(seat: Spot, ctx: RoomContext): { face: Face; along: number; far: number }[] {
  const f = frontOf(seat.rotation);
  return ctx.faces.flatMap((face) => {
    const square = -dot(f, face.inward);
    if (square < 0.9) return [];
    const rel = { x: seat.x - face.p.x, y: seat.y - face.p.y };
    const far = dot(rel, face.inward) / square;
    if (far <= 0) return [];
    const along = dot({ x: rel.x + f.x * far, y: rel.y + f.y * far }, face.d);
    return along >= 0 && along <= face.length ? [{ face, along, far }] : [];
  });
}

/** How well a spot for a sofa leaves a wall ahead to put the TV on, at a distance to watch. */
function viewAhead(seat: Spot, tv: Item, ctx: RoomContext): number {
  const room = (w: { face: Face; along: number }) =>
    w.along >= tv.product.dims.w / 2 && w.along <= w.face.length - tv.product.dims.w / 2;
  const fits = wallAhead(seat, ctx)
    .filter(room)
    .map((w) => {
      const gap = w.far - tv.product.dims.d / 2;
      const slack = 2.5;
      return Math.max(
        0,
        1 - Math.max(VIEWING_DISTANCE.from - gap, gap - VIEWING_DISTANCE.to, 0) / slack,
      );
    });
  return Math.max(0, ...fits);
}

/** Spots for a TV unit on the wall a seat looks straight at, centered on it or a little off. */
function viewSpots(tv: Item, seat: Spot, ctx: RoomContext): Spot[] {
  const half = tv.product.dims.w / 2;
  return wallAhead(seat, ctx).flatMap(({ face, along }) => {
    if (face.length < 2 * half) return [];
    const rotation = facing(face.inward);
    const depth = tv.product.dims.d / 2;
    return [0, -0.2, 0.2, -0.4, 0.4].map((off) => {
      const s = Math.min(Math.max(along + off, half), face.length - half);
      return {
        x: face.p.x + face.d.x * s + face.inward.x * depth,
        y: face.p.y + face.d.y * s + face.inward.y * depth,
        rotation,
      };
    });
  });
}

/**
 * Spots for an armchair in the sofa's group: at each end of the coffee table (or of the space in
 * front of a sofa without one), straight or a little toward the room, and across the table from
 * the sofa, each turned toward the table.
 */
function groupSpots(chair: Item, placed: Map<string, Piece>): Spot[] {
  const pieces = [...placed.values()];
  const sofa = pieces.find((p) => p.product.category === 'sofa');
  const table = pieces.find((p) => p.product.category === 'coffee_table');
  if (!sofa && !table) return [];
  const axis = (sofa ?? table)!.placement.rotation;
  const [f, l] = [frontOf(axis), leftOf(axis)];
  const hub = table
    ? { x: table.placement.x, y: table.placement.y }
    : { x: sofa!.placement.x + f.x * 0.9, y: sofa!.placement.y + f.y * 0.9 };
  const half = table ? reach(table.product, table.placement.rotation, l) : 0.45;
  const deep = table ? reach(table.product, table.placement.rotation, f) : 0.3;
  const seat = chair.product.dims.d / 2 + 0.35;
  const toward = (p: Vec2) => ({ ...p, rotation: Math.atan2(hub.x - p.x, hub.y - p.y) });
  const spots: Spot[] = [];
  for (const side of [1, -1]) {
    for (const ahead of [0, 0.4, 0.8]) {
      spots.push(
        toward({
          x: hub.x + l.x * side * (half + seat) + f.x * ahead,
          y: hub.y + l.y * side * (half + seat) + f.y * ahead,
        }),
      );
    }
  }
  spots.push(toward({ x: hub.x + f.x * (deep + seat), y: hub.y + f.y * (deep + seat) }));
  return spots;
}

/** Spots on a grid over the floor, turned square to each wall or toward what it should face. */
function floorSpots(ctx: RoomContext, toward: Vec2[]): Spot[] {
  const { min, max } = bounds(ctx.floor);
  const turns = [...new Set(ctx.faces.map((f) => +facing(f.inward).toFixed(6)))];
  if (turns.length === 0) turns.push(0, Math.PI / 2, Math.PI, -Math.PI / 2);
  const spots: Spot[] = [];
  for (let x = min.x + FLOOR_STEP / 2; x < max.x; x += FLOOR_STEP) {
    for (let y = min.y + FLOOR_STEP / 2; y < max.y; y += FLOOR_STEP) {
      if (!contains(ctx.floor, { x, y })) continue;
      for (const rotation of turns) spots.push({ x, y, rotation });
      for (const t of toward) spots.push({ x, y, rotation: Math.atan2(t.x - x, t.y - y) });
    }
  }
  return spots;
}

/** Spots that a relation suggests, relative to items already placed. */
function relativeSpots(
  item: Item,
  relations: readonly Relation[],
  placed: Map<string, Piece>,
): Spot[] {
  const spots: Spot[] = [];
  const { product } = item;
  for (const r of relations) {
    if (r.kind === 'in_front_of' && r.item === item.ref) {
      const target = placed.get(r.target);
      if (!target) continue;
      const f = frontOf(target.placement.rotation);
      const close = r.distance === 'close';
      const rotation = close ? turn(target.placement.rotation, Math.PI) : target.placement.rotation;
      const gap = close ? -0.1 : 0.42;
      const off = target.product.dims.d / 2 + gap + reach(product, rotation, f);
      spots.push({
        x: target.placement.x + f.x * off,
        y: target.placement.y + f.y * off,
        rotation,
      });
    }
    if (r.kind === 'beside' && r.item === item.ref) {
      const target = placed.get(r.target);
      if (!target) continue;
      const { rotation } = target.placement;
      const [f, l] = [frontOf(rotation), leftOf(rotation)];
      const sides = r.side === 'left' ? [1] : r.side === 'right' ? [-1] : [1, -1];
      const back = -target.product.dims.d / 2 + reach(product, rotation, f);
      for (const side of sides) {
        const across = side * (target.product.dims.w / 2 + 0.03 + reach(product, rotation, l));
        spots.push({
          x: target.placement.x + l.x * across + f.x * back,
          y: target.placement.y + l.y * across + f.y * back,
          rotation,
        });
      }
    }
    if (r.kind === 'around' && r.items.includes(item.ref)) {
      const table = placed.get(r.target);
      if (!table) continue;
      const { x, y, rotation } = table.placement;
      const { w, d } = table.product.dims;
      const tuck = product.dims.d / 2 - 0.1;
      const seats: { across: number; along: number }[] =
        table.product.shape === 'round'
          ? Array.from({ length: 8 }, (_, k) => {
              const a = (k * Math.PI) / 4;
              return { across: Math.sin(a) * (w / 2 + tuck), along: Math.cos(a) * (w / 2 + tuck) };
            })
          : [
              ...[-w / 4, 0, w / 4].flatMap((a) => [
                { across: a, along: d / 2 + tuck },
                { across: a, along: -d / 2 - tuck },
              ]),
              { across: w / 2 + tuck, along: 0 },
              { across: -w / 2 - tuck, along: 0 },
            ];
      const [f, l] = [frontOf(rotation), leftOf(rotation)];
      for (const s of seats) {
        const at = { x: x + l.x * s.across + f.x * s.along, y: y + l.y * s.across + f.y * s.along };
        spots.push({ ...at, rotation: Math.atan2(x - at.x, y - at.y) });
      }
    }
    if (r.kind === 'under' && r.item === item.ref) {
      const targets = r.targets.map((t) => placed.get(t)).filter((t): t is Piece => !!t);
      if (targets.length === 0) continue;
      // Centered on the targets, reaching a little under the first one's front.
      const first = targets[0]!;
      const f = frontOf(first.placement.rotation);
      const lip = first.product.dims.d / 2 - 0.15;
      const points = [
        { x: first.placement.x + f.x * lip, y: first.placement.y + f.y * lip },
        ...targets.slice(1).map((t) => ({ x: t.placement.x, y: t.placement.y })),
      ];
      const c = {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      };
      for (const t of [0, Math.PI / 2])
        spots.push({ ...c, rotation: turn(first.placement.rotation, t) });
    }
    if (r.kind === 'pair' && (r.first === item.ref || r.second === item.ref)) {
      const other = placed.get(r.first === item.ref ? r.second : r.first);
      const about = placed.get(r.about);
      if (!other || !about) continue;
      // The other one, mirrored across the middle of what they pair about.
      const l = leftOf(about.placement.rotation);
      const across = dot(
        { x: other.placement.x - about.placement.x, y: other.placement.y - about.placement.y },
        l,
      );
      spots.push({
        x: other.placement.x - l.x * 2 * across,
        y: other.placement.y - l.y * 2 * across,
        rotation: other.placement.rotation,
      });
    }
  }
  return spots;
}

/** The places an item could look toward, for spots turned to face them. */
function lookTargets(
  item: Item,
  relations: readonly Relation[],
  placed: Map<string, Piece>,
  ctx: RoomContext,
): Vec2[] {
  return relations.flatMap((r) => {
    if (r.kind !== 'facing' || r.item !== item.ref) return [];
    if (r.target === 'room_center') return [ctx.center];
    if (r.target === 'window') return ctx.windows.map((w) => w.center);
    const t = placed.get(r.target);
    return t ? [{ x: t.placement.x, y: t.placement.y }] : [];
  });
}

/**
 * The item another one hangs off, if it has one: what it's beside, in front of, around or
 * under. Such an item only goes next to its anchor, never just anywhere.
 */
export function anchorOf(ref: string, relations: readonly Relation[]): string | undefined {
  for (const r of relations) {
    if ((r.kind === 'beside' || r.kind === 'in_front_of') && r.item === ref) return r.target;
    if (r.kind === 'around' && r.items.includes(ref)) return r.target;
    // A rug goes in once everything it lies under is in.
    if (r.kind === 'under' && r.item === ref) return r.targets.at(-1);
  }
  return undefined;
}

/** Spots near ones next to an anchor, a little along and across, in case those are taken. */
function withLeeway(spots: readonly Spot[]): Spot[] {
  const out: Spot[] = [];
  for (const spot of spots) {
    const [f, l] = [frontOf(spot.rotation), leftOf(spot.rotation)];
    for (const across of [0, -0.05, 0.05, -0.1, 0.1, -0.2, 0.2]) {
      for (const along of [0, -0.1, 0.1]) {
        out.push({
          x: spot.x + l.x * across + f.x * along,
          y: spot.y + l.y * across + f.y * along,
          rotation: spot.rotation,
        });
      }
    }
  }
  return out;
}

/** Items that hang off another: placed relative to it, so they move with it. */
function dependents(ref: string, relations: readonly Relation[]): string[] {
  return relations.flatMap((r) => {
    if ((r.kind === 'beside' || r.kind === 'in_front_of') && r.target === ref) return [r.item];
    if (r.kind === 'around' && r.target === ref) return r.items;
    if (r.kind === 'under' && r.targets[0] === ref) return [r.item];
    return [];
  });
}

/**
 * Furnishes one room from its intent: every item at a valid spot if it can be, the layout
 * scored, and the items that couldn't be placed listed with the reason. The same seed gives the
 * same layout.
 */
export function solveRoom(
  plan: LayoutPlan,
  intent: RoomIntent,
  products: ReadonlyMap<string, ScoredProduct>,
  options: SolveOptions,
): RoomSolution {
  const ctx = roomContext(plan, intent.roomId);
  const roomId = intent.roomId;
  if (!ctx) {
    const reason = `There's no room ${roomId} on the plan.`;
    return {
      roomId,
      placements: [],
      unplaced: intent.items.map((i) => ({ ref: i.ref, reason })),
      score: 0,
      breakdown: {},
    };
  }
  const rng = seeded(options.seed);
  const relations = intent.relations;
  const byCategory: Item[] = intent.items
    .flatMap((i) => {
      const product = products.get(i.articleNo);
      return product ? [{ ref: i.ref, articleNo: i.articleNo, product }] : [];
    })
    .sort((a, b) => ORDER.indexOf(a.product.category) - ORDER.indexOf(b.product.category));
  // Each item's dependents go in straight after it, before other items can take their spots.
  const items: Item[] = [];
  const emit = (item: Item) => {
    if (items.includes(item)) return;
    items.push(item);
    for (const d of byCategory) if (anchorOf(d.ref, relations) === item.ref) emit(d);
  };
  for (const item of byCategory) {
    const anchor = anchorOf(item.ref, relations);
    if (anchor === undefined || !byCategory.some((i) => i.ref === anchor)) emit(item);
  }
  // Anything left in a loop of anchors goes in last.
  for (const item of byCategory) emit(item);
  const unplaced: RoomSolution['unplaced'] = intent.items
    .filter((i) => !products.has(i.articleNo))
    .map((i) => ({ ref: i.ref, reason: `Product ${i.articleNo} isn't in the catalog.` }));

  const placed = new Map<string, Piece>();
  const toPlacement = (item: Item, spot: Spot): Placement => ({
    id: item.ref,
    articleNo: item.articleNo,
    roomId,
    ...spot,
  });
  const placements = () =>
    [...placed.values()].map((p) => {
      const item = items.find((i) => i.ref === p.ref)!;
      return toPlacement(item, p.placement);
    });
  // Problems the other rooms' furniture already has are theirs, not this room's.
  const others = options.others ?? [];
  const known = new Set(validateLayout(plan, others, products).map((p) => p.message));
  const valid = (layout: Placement[], paths: boolean) =>
    others.length === 0
      ? validateLayout(plan, layout, products, { paths }).length === 0
      : validateLayout(plan, [...others, ...layout], products, { paths }).every((p) =>
          known.has(p.message),
        );
  const score = (pieces: Piece[], walkway = false) =>
    scoreRoom(ctx, pieces, { relations, walkway }).score;
  // Spots an item must leave: where it stands now, when the room is being rearranged.
  const leaves = (ref: string, spot: Spot) =>
    !(options.avoid ?? []).some(
      (a) =>
        a.id === ref &&
        Math.hypot(a.x - spot.x, a.y - spot.y) < STAY &&
        Math.abs(turn(spot.rotation, -a.rotation)) < 0.01,
    );
  /** Spots anywhere in the room an item could go, not only by an item it hangs off. */
  // The sofa that will watch the TV, whatever the intent said: the first sofa, else any seat.
  const watcher = () =>
    [...placed.values()].find((p) => p.product.category === 'sofa') ??
    [...placed.values()].find((p) => p.product.category === 'armchair');
  const anywhere = (item: Item) => [
    ...relativeSpots(item, relations, placed),
    ...(item.product.category === 'tv_unit' && watcher()
      ? viewSpots(item, watcher()!.placement, ctx)
      : []),
    ...(item.product.category === 'armchair' ? groupSpots(item, placed) : []),
    ...(AGAINST_WALL.has(item.product.category)
      ? wallSpots(item, ctx, item.product.category === 'bed' && item.product.dims.w < 1.4)
      : []),
    ...(FREE_STANDING.has(item.product.category) || !AGAINST_WALL.has(item.product.category)
      ? floorSpots(ctx, lookTargets(item, relations, placed, ctx))
      : []),
  ];

  /** One of the best few valid spots, drawn the likelier the better, and whether any fit alone. */
  const pick = (item: Item, spots: Spot[]) => {
    const others = [...placed.values()];
    // A sofa goes where a TV still to place can stand straight ahead of it.
    const tv =
      item.product.category === 'sofa' && !watcher()
        ? items.find((i) => i.product.category === 'tv_unit' && !placed.has(i.ref))
        : undefined;
    const ranked: { spot: Spot; score: number }[] = spots
      .filter((spot) => leaves(item.ref, spot))
      .map((spot) => ({
        spot,
        score:
          score([...others, { ref: item.ref, placement: spot, product: item.product }]) +
          (tv ? LOOK_AHEAD * viewAhead(spot, tv, ctx) : 0),
      }))
      .sort((a, b) => b.score - a.score);
    const current = placements();
    const alone = (spot: Spot) => valid([toPlacement(item, spot)], false);
    let fitsAlone = false;
    const good: typeof ranked = [];
    for (const r of ranked) {
      if (!alone(r.spot)) continue;
      fitsAlone = true;
      if (valid([...current, toPlacement(item, r.spot)], false)) good.push(r);
      if (good.length >= DRAW * 3) break;
    }
    while (good.length > 0) {
      const pool = good.slice(0, DRAW);
      const weights = pool.map((g) => Math.exp((g.score - pool[0]!.score) / DRAW_SPREAD));
      let draw = rng() * weights.reduce((a, b) => a + b, 0);
      let k = 0;
      while (k < pool.length - 1 && (draw -= weights[k]!) > 0) k++;
      const [candidate] = good.splice(k, 1);
      if (valid([...current, toPlacement(item, candidate!.spot)], true)) {
        return { chosen: candidate!.spot, fitsAlone };
      }
    }
    return { chosen: undefined, fitsAlone };
  };

  for (const item of items) {
    // An item that hangs off one already placed goes next to it, or else not at all, unless
    // every item must be placed.
    const anchor = anchorOf(item.ref, relations);
    const anchored = anchor !== undefined && placed.has(anchor);
    let { chosen, fitsAlone } = pick(
      item,
      anchored ? withLeeway(relativeSpots(item, relations, placed)) : anywhere(item),
    );
    if (!chosen && anchored && options.placeAll)
      ({ chosen, fitsAlone } = pick(item, anywhere(item)));
    if (chosen) {
      placed.set(item.ref, { ref: item.ref, placement: chosen, product: item.product });
      continue;
    }
    const noun = ITEM_NOUNS[item.product.category];
    const size = `${item.product.dims.w.toFixed(2)} × ${item.product.dims.d.toFixed(2)} m`;
    if (anchored) {
      const by = ITEM_NOUNS[placed.get(anchor!)!.product.category];
      unplaced.push({
        ref: item.ref,
        reason: `There's no room for the ${size} ${noun} by the ${by} in the ${ctx.room.name}.`,
      });
      continue;
    }
    unplaced.push({
      ref: item.ref,
      reason: fitsAlone
        ? `The ${size} ${noun} has no spot left in the ${ctx.room.name} once the rest is in.`
        : `The ${size} ${noun} doesn't fit anywhere in the ${ctx.room.name} ` +
          'with the space it needs.',
    });
  }

  // Local search: move an item, with what hangs off it, to another spot or a little way off;
  // keep the move if the room stays valid and scores higher.
  let best = score([...placed.values()]);
  const refs = [...placed.keys()];
  for (let step = 0; step < (options.steps ?? 150) && refs.length > 0; step++) {
    const ref = refs[Math.floor(rng() * refs.length)]!;
    const piece = placed.get(ref)!;
    const item = items.find((i) => i.ref === ref)!;
    const others = new Map([...placed].filter(([r]) => r !== ref));
    let to: Spot;
    if (rng() < 0.5) {
      const anchor = anchorOf(ref, relations);
      const spots =
        anchor !== undefined && others.has(anchor)
          ? withLeeway(relativeSpots(item, relations, others))
          : [
              ...relativeSpots(item, relations, others),
              ...(AGAINST_WALL.has(item.product.category) ? wallSpots(item, ctx, false) : []),
            ];
      if (spots.length === 0) continue;
      to = spots[Math.floor(rng() * spots.length)]!;
    } else {
      const { x, y, rotation } = piece.placement;
      const [f, l] = [frontOf(rotation), leftOf(rotation)];
      const [a, b] = [(rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4];
      to = { x: x + l.x * a + f.x * b, y: y + l.y * a + f.y * b, rotation };
    }
    // The items hanging off it follow, turned with it.
    const moved = new Map(placed);
    const { x: x0, y: y0, rotation: r0 } = piece.placement;
    const spin = to.rotation - r0;
    const [c, s] = [Math.cos(spin), Math.sin(spin)];
    moved.set(ref, { ...piece, placement: to });
    for (const dep of dependents(ref, relations)) {
      const d = placed.get(dep);
      if (!d) continue;
      const [dx, dy] = [d.placement.x - x0, d.placement.y - y0];
      moved.set(dep, {
        ...d,
        placement: {
          x: to.x + dx * c + dy * s,
          y: to.y - dx * s + dy * c,
          rotation: turn(d.placement.rotation, spin),
        },
      });
    }
    if (![...moved].every(([r, p]) => leaves(r, p.placement))) continue;
    const next = score([...moved.values()]);
    if (next <= best + 1e-9) continue;
    const layout = [...moved.values()].map((p) =>
      toPlacement(
        items.find((i) => i.ref === p.ref)!,
        p.placement,
      ),
    );
    if (!valid(layout, false) || !valid(layout, true)) continue;
    for (const [r, p] of moved) placed.set(r, p);
    best = next;
  }

  const final = scoreRoom(ctx, [...placed.values()], { relations });
  return { roomId, placements: placements(), unplaced, ...final };
}
