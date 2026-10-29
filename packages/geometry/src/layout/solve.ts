import type { Category, Placement, Relation, RoomIntent, Vec2 } from '@roomie/schema';
import { bounds, contains } from '../plan/polygon';
import { type RoomContext, roomContext } from './room';
import { type Piece, type Scored, type ScoredProduct, scoreRoom } from './score';
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

export type SolveOptions = {
  seed: number;
  /** Local search moves to try. */
  steps?: number;
  /**
   * Furniture already standing in other rooms, which this room mustn't make invalid: rooms open
   * to each other share walkways. Their ids must differ from this room's refs.
   */
  others?: readonly Placement[];
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
  const items: Item[] = intent.items
    .flatMap((i) => {
      const product = products.get(i.articleNo);
      return product ? [{ ref: i.ref, articleNo: i.articleNo, product }] : [];
    })
    .sort((a, b) => ORDER.indexOf(a.product.category) - ORDER.indexOf(b.product.category));
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

  for (const item of items) {
    const spots: Spot[] = [
      ...relativeSpots(item, relations, placed),
      ...(AGAINST_WALL.has(item.product.category)
        ? wallSpots(item, ctx, item.product.category === 'bed' && item.product.dims.w < 1.4)
        : []),
      ...(FREE_STANDING.has(item.product.category) || !AGAINST_WALL.has(item.product.category)
        ? floorSpots(ctx, lookTargets(item, relations, placed, ctx))
        : []),
    ];
    const others = [...placed.values()];
    const ranked: { spot: Spot; score: number }[] = spots
      .map((spot) => ({
        spot,
        score: score([...others, { ref: item.ref, placement: spot, product: item.product }]),
      }))
      .sort((a, b) => b.score - a.score);

    // The best few valid spots, then one drawn among them, the better the likelier.
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
    let chosen: Spot | undefined;
    while (good.length > 0) {
      const pool = good.slice(0, DRAW);
      const weights = pool.map((g) => Math.exp((g.score - pool[0]!.score) / DRAW_SPREAD));
      let pick = rng() * weights.reduce((a, b) => a + b, 0);
      let k = 0;
      while (k < pool.length - 1 && (pick -= weights[k]!) > 0) k++;
      const [candidate] = good.splice(k, 1);
      if (valid([...current, toPlacement(item, candidate!.spot)], true)) {
        chosen = candidate!.spot;
        break;
      }
    }
    if (chosen) {
      placed.set(item.ref, { ref: item.ref, placement: chosen, product: item.product });
      continue;
    }
    const noun = ITEM_NOUNS[item.product.category];
    const size = `${item.product.dims.w.toFixed(2)} × ${item.product.dims.d.toFixed(2)} m`;
    unplaced.push({
      ref: item.ref,
      reason: fitsAlone
        ? `The ${size} ${noun} has no spot left in the ${ctx.room.name} once the rest is in.`
        : `The ${size} ${noun} doesn't fit anywhere in the ${ctx.room.name} with the space it needs.`,
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
      const spots = [
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
    const next = score([...moved.values()]);
    if (next <= best + 1e-9) continue;
    const layout = [...moved.values()].map((p) =>
      toPlacement(items.find((i) => i.ref === p.ref)!, p.placement),
    );
    if (!valid(layout, false) || !valid(layout, true)) continue;
    for (const [r, p] of moved) placed.set(r, p);
    best = next;
  }

  const final = scoreRoom(ctx, [...placed.values()], { relations });
  return { roomId, placements: placements(), unplaced, ...final };
}
