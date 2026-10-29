import type {
  Category,
  Placement,
  Product,
  Relation,
  RoomIntent,
  StylePreset,
  Vec2,
} from '@roomie/schema';
import weights from '../../weights.json';
import { contains } from '../plan/polygon';
import { walkableShare } from './paths';
import { type Face, type RoomContext, roomContext } from './room';
import { itemOutline, overlaps, reach, shape } from './shapes';
import { styleMatch, words } from './style';
import type { LayoutPlan } from './validate';

// Soft scores (PLAN.md M4): each in [0, 1], logged one by one in a layout's score breakdown and
// weighted by weights.json. A feature that doesn't apply (no desk, no windows) is left out rather
// than scored, so it neither helps nor hurts.

/** What scoring needs to know about a product. */
export type ScoredProduct = Pick<
  Product,
  'category' | 'dims' | 'shape' | 'priceCad' | 'color' | 'material'
>;

/** An item in a room, by the name the intent gave it. */
export type Piece = {
  ref: string;
  placement: Pick<Placement, 'x' | 'y' | 'rotation'>;
  product: ScoredProduct;
};

export type Scored = { score: number; breakdown: Record<string, number> };

/** Items that belong against a wall. */
const WALL_ITEMS: ReadonlySet<Category> = new Set([
  'bed',
  'sofa',
  'wardrobe',
  'dresser',
  'shelving',
  'tv_unit',
  'desk',
]);
const SEATING: ReadonlySet<Category> = new Set(['sofa', 'armchair']);

const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const mean = (values: readonly number[]) =>
  values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length;
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
/** How close a value is to a range: 1 inside it, falling to 0 `slack` outside. */
const within = (v: number, lo: number, hi: number, slack: number) =>
  clamp(1 - Math.max(lo - v, v - hi, 0) / slack);

/** Where an item faces, and its left (as seen looking where it faces), on the plan. */
function axes(rotation: number) {
  return {
    front: { x: Math.sin(rotation), y: Math.cos(rotation) },
    left: { x: Math.cos(rotation), y: -Math.sin(rotation) },
  };
}

const at = (piece: Piece): Vec2 => ({ x: piece.placement.x, y: piece.placement.y });

/** A point in a piece's own frame: across (+ to its left) and along (+ to its front). */
function local(piece: Piece, p: Vec2) {
  const { front, left } = axes(piece.placement.rotation);
  const rel = { x: p.x - piece.placement.x, y: p.y - piece.placement.y };
  return { across: dot(rel, left), along: dot(rel, front) };
}

/** How well a piece's back sits against a wall face: 1 flush and square, 0 away from it. */
function flush(piece: Piece, face: Face): number {
  const { front } = axes(piece.placement.rotation);
  const { product, placement } = piece;
  const rel = { x: placement.x - face.p.x, y: placement.y - face.p.y };
  const along = dot(rel, face.d);
  const side = reach(product, placement.rotation, face.d);
  if (along + side <= 0 || along - side >= face.length) return 0;
  const gap = dot(rel, face.inward) - product.dims.d / 2;
  return clamp(1 - Math.abs(gap) / 0.3) * Math.max(0, dot(front, face.inward)) ** 2;
}

/** The face a piece's back is against, if any, and how well. */
function backFace(piece: Piece, ctx: RoomContext): { face?: Face; score: number } {
  let best: { face?: Face; score: number } = { score: 0 };
  for (const face of ctx.faces) {
    const score = flush(piece, face);
    if (score > best.score) best = { face, score };
  }
  return best;
}

/** How far a piece's sides are from a face (less than 0 when through it), if beside it. */
function sideGap(piece: Piece, face: Face): number | undefined {
  const { product, placement } = piece;
  const rel = { x: placement.x - face.p.x, y: placement.y - face.p.y };
  const along = dot(rel, face.d);
  const side = reach(product, placement.rotation, face.d);
  if (along + side <= 0 || along - side >= face.length) return undefined;
  return dot(rel, face.inward) - reach(product, placement.rotation, face.inward);
}

function wallChoice(face: Face, wall: string, ctx: RoomContext): number {
  const longest = Math.max(...ctx.faces.map((f) => f.length));
  const plain = ctx.faces.filter((f) => f.windows.length === 0);
  switch (wall) {
    case 'longest':
      return face.length >= 0.9 * longest ? 1 : 0.6;
    case 'longest_windowless': {
      if (plain.length === 0) return face.length >= 0.9 * longest ? 1 : 0.6;
      if (!plain.includes(face)) return 0.5;
      return face.length >= 0.9 * Math.max(...plain.map((f) => f.length)) ? 1 : 0.8;
    }
    case 'opposite_door': {
      if (ctx.doors.length === 0) return 1;
      const far = (f: Face) =>
        Math.min(
          ...ctx.doors.map((d) => Math.abs(dot({ x: d.x - f.p.x, y: d.y - f.p.y }, f.inward))),
        );
      const farthest = Math.max(...ctx.faces.map(far));
      return farthest <= 0 ? 1 : Math.max(0.5, far(face) / farthest);
    }
    default:
      return 1;
  }
}

/**
 * How well a relation holds, in [0, 1]; undefined when it names an item that isn't there or a
 * window or door the room hasn't got.
 */
export function relationScore(
  relation: Relation,
  pieces: ReadonlyMap<string, Piece>,
  ctx: RoomContext,
): number | undefined {
  const item = 'item' in relation ? pieces.get(relation.item) : undefined;
  switch (relation.kind) {
    case 'against_wall': {
      if (!item) return undefined;
      const scores = ctx.faces.map((f) => flush(item, f) * wallChoice(f, relation.wall, ctx));
      return Math.max(0, ...scores);
    }
    case 'facing': {
      if (!item) return undefined;
      let target: Vec2 | undefined;
      if (relation.target === 'room_center') target = ctx.center;
      else if (relation.target === 'window') {
        const c = at(item);
        target = ctx.windows
          .map((w) => w.center)
          .sort((a, b) => distance(a, c) - distance(b, c))[0];
      } else {
        const other = pieces.get(relation.target);
        target = other && at(other);
      }
      if (!target) return undefined;
      const { front } = axes(item.placement.rotation);
      const to = { x: target.x - item.placement.x, y: target.y - item.placement.y };
      const length = Math.hypot(to.x, to.y);
      return length < 1e-9 ? 1 : Math.max(0, dot(front, to) / length);
    }
    case 'in_front_of': {
      const target = pieces.get(relation.target);
      if (!item || !target) return undefined;
      const { across, along } = local(target, at(item));
      const toward = axes(target.placement.rotation).front;
      const gap =
        along - target.product.dims.d / 2 - reach(item.product, item.placement.rotation, toward);
      if (along <= 0) return 0;
      const fits =
        relation.distance === 'close' ? within(gap, -0.3, 0.1, 0.4) : within(gap, 0.35, 0.5, 0.5);
      return fits * clamp(1 - Math.abs(across) / Math.max(target.product.dims.w / 2, 0.3));
    }
    case 'beside': {
      const target = pieces.get(relation.target);
      if (!item || !target) return undefined;
      const { across, along } = local(target, at(item));
      const side =
        relation.side === 'left' ? across > 0 : relation.side === 'right' ? across < 0 : true;
      if (!side) return 0;
      const sideways = axes(target.placement.rotation).left;
      const gap =
        Math.abs(across) -
        target.product.dims.w / 2 -
        reach(item.product, item.placement.rotation, sideways);
      // Its back in line with the target's back: a nightstand at the head of the bed.
      const forward = axes(target.placement.rotation).front;
      const back = along - reach(item.product, item.placement.rotation, forward);
      return (
        within(gap, -0.02, 0.15, 0.4) *
        within(back, -target.product.dims.d / 2 - 0.05, -target.product.dims.d / 2 + 0.1, 0.5)
      );
    }
    case 'around': {
      const table = pieces.get(relation.target);
      const chairs = relation.items.map((r) => pieces.get(r)).filter((c): c is Piece => !!c);
      if (!table || chairs.length === 0) return undefined;
      return mean(
        chairs.map((chair) => {
          const { across, along } = local(table, at(chair));
          const { w, d } = table.product.dims;
          const edge =
            table.product.shape === 'round'
              ? Math.max(0, Math.hypot(across, along) - w / 2)
              : Math.hypot(
                  Math.max(Math.abs(across) - w / 2, 0),
                  Math.max(Math.abs(along) - d / 2, 0),
                );
          const { front } = axes(chair.placement.rotation);
          const to = {
            x: table.placement.x - chair.placement.x,
            y: table.placement.y - chair.placement.y,
          };
          const length = Math.hypot(to.x, to.y) || 1;
          return within(edge, 0, 0.35, 0.5) * Math.max(0, dot(front, to) / length);
        }),
      );
    }
    case 'under': {
      const targets = relation.targets.map((r) => pieces.get(r)).filter((t): t is Piece => !!t);
      if (!item || targets.length === 0) return undefined;
      const rug = itemOutline(item.placement, item.product);
      return mean(
        targets.map((t) => {
          if (contains(rug, at(t))) return 1;
          // A sofa with only its front legs on the rug is fine too.
          const { front } = axes(t.placement.rotation);
          const lip = t.product.dims.d / 2 - 0.1;
          return contains(rug, {
            x: t.placement.x + front.x * lip,
            y: t.placement.y + front.y * lip,
          })
            ? 0.7
            : 0;
        }),
      );
    }
    case 'in_corner': {
      if (!item) return undefined;
      const touching = ctx.faces.filter((f) => {
        const gap = sideGap(item, f);
        return gap !== undefined && Math.abs(gap) < 0.05;
      }).length;
      return touching >= 2 ? 1 : touching === 1 ? 0.5 : 0;
    }
    case 'near_window': {
      if (!item || ctx.windows.length === 0) return undefined;
      const d = Math.min(...ctx.windows.map((w) => distance(w.center, at(item))));
      return within(d, 0, 1.2, 2.3);
    }
    case 'away_from_door': {
      if (!item || ctx.doors.length === 0) return undefined;
      const d = Math.min(...ctx.doors.map((door) => distance(door, at(item))));
      return clamp((d - 1) / 2);
    }
    case 'pair': {
      const [a, b, about] = [relation.first, relation.second, relation.about].map((r) =>
        pieces.get(r),
      );
      if (!a || !b || !about) return undefined;
      const [p, q] = [local(about, at(a)), local(about, at(b))];
      return clamp(1 - Math.hypot(p.across + q.across, p.along - q.along) / 0.5);
    }
  }
}

type RoomOptions = {
  relations?: readonly Relation[];
  /** Leave out the walkway feature, the slowest, while searching. */
  walkway?: boolean;
};

/** The free-floor share an empty room has, worked out once per room. */
const emptyShare = new WeakMap<RoomContext, number>();

/** A room's soft scores, and their weighted mean. */
export function scoreRoom(
  ctx: RoomContext,
  pieces: readonly Piece[],
  options: RoomOptions = {},
): Scored {
  const byRef = new Map(pieces.map((p) => [p.ref, p]));
  const features: Record<string, number | undefined> = {};
  const standing = pieces.filter((p) => p.product.category !== 'rug');

  features.relations = mean(
    (options.relations ?? [])
      .map((r) => relationScore(r, byRef, ctx))
      .filter((s): s is number => s !== undefined),
  );
  features.walls = mean(
    standing.filter((p) => WALL_ITEMS.has(p.product.category)).map((p) => backFace(p, ctx).score),
  );

  const seats = standing.filter((p) => SEATING.has(p.product.category));
  const tv = standing.filter((p) => p.product.category === 'tv_unit');
  const focus = tv.length > 0 ? tv : standing.filter((p) => p.product.category === 'coffee_table');
  if (focus.length > 0) {
    features.focal = mean(
      seats.map((seat) => {
        const { front } = axes(seat.placement.rotation);
        return Math.max(
          ...focus.map((f) => {
            const to = { x: f.placement.x - seat.placement.x, y: f.placement.y - seat.placement.y };
            return Math.max(0, dot(front, to) / (Math.hypot(to.x, to.y) || 1));
          }),
        );
      }),
    );
  }

  if (options.walkway !== false && standing.length > 0) {
    let empty = emptyShare.get(ctx);
    if (empty === undefined) {
      empty = walkableShare(ctx.floor, ctx.beyond, []);
      emptyShare.set(ctx, empty);
    }
    const outlines = standing.map((p) => itemOutline(p.placement, p.product));
    features.walkway =
      empty > 0 ? clamp(walkableShare(ctx.floor, ctx.beyond, outlines) / empty) : undefined;
  }

  features.bed_head = mean(
    standing
      .filter((p) => p.product.category === 'bed')
      .map((bed) => {
        const { face, score } = backFace(bed, ctx);
        if (!face) return 0;
        // Not with its head under a window.
        const along = dot({ x: bed.placement.x - face.p.x, y: bed.placement.y - face.p.y }, face.d);
        const half = reach(bed.product, bed.placement.rotation, face.d);
        const under = face.windows.some((w) => w.from < along + half && w.to > along - half);
        return score * (under ? 0.6 : 1);
      }),
  );

  if (ctx.windows.length > 0) {
    features.desk_window = mean(
      standing
        .filter((p) => p.product.category === 'desk')
        .map((desk) => relationScore({ kind: 'near_window', item: desk.ref }, byRef, ctx) ?? 0),
    );
    // Windows kept clear of anything taller than their sill, 40 cm in front of them.
    const windows = ctx.faces.flatMap((f) =>
      f.windows.map((w) => {
        const point = (along: number, depth: number) => ({
          x: f.p.x + f.d.x * along + f.inward.x * depth,
          y: f.p.y + f.d.y * along + f.inward.y * depth,
        });
        const front = shape([
          point(w.from, 0),
          point(w.to, 0),
          point(w.to, 0.4),
          point(w.from, 0.4),
        ]);
        return { front, sill: w.sill };
      }),
    );
    if (windows.length > 0) {
      const clear = windows.filter(
        (w) =>
          !standing.some(
            (p) =>
              p.product.dims.h > w.sill &&
              overlaps(shape(itemOutline(p.placement, p.product)), w.front, 0.01),
          ),
      );
      features.windows = clear.length / windows.length;
    }
  }

  if (standing.length >= 2) {
    let [sx, sy, total] = [0, 0, 0];
    for (const p of standing) {
      const a = p.product.dims.w * p.product.dims.d;
      sx += p.placement.x * a;
      sy += p.placement.y * a;
      total += a;
    }
    const off = distance({ x: sx / total, y: sy / total }, ctx.center);
    features.spread = clamp(1 - off / (Math.sqrt(ctx.area) / 2));
  }

  return weigh(features, weights.room);
}

/** The weighted mean of the features that apply, and the features themselves. */
function weigh(features: Record<string, number | undefined>, by: Record<string, number>): Scored {
  const breakdown: Record<string, number> = {};
  let [sum, total] = [0, 0];
  for (const [name, value] of Object.entries(features)) {
    if (value === undefined) continue;
    breakdown[name] = value;
    const w = by[name] ?? 0;
    sum += w * value;
    total += w;
  }
  return { score: total > 0 ? sum / total : 0, breakdown };
}

type HomeInput = {
  rooms: readonly {
    roomId: string;
    area: number;
    score: number;
    products: readonly ScoredProduct[];
  }[];
  style?: StylePreset;
  budgetCad?: number;
};

/**
 * A home's score: its rooms' scores, weighted by area, with the style held across rooms and the
 * budget used. Over budget scores 0 here, and is a hard failure for whoever generates it.
 */
export function scoreHome({ rooms, style, budgetCad }: HomeInput): Scored {
  const features: Record<string, number | undefined> = {};
  const area = rooms.reduce((s, r) => s + r.area, 0);
  features.rooms = area > 0 ? rooms.reduce((s, r) => s + r.score * r.area, 0) / area : undefined;
  const products = rooms.flatMap((r) => r.products);
  if (style) features.style_match = mean(products.map((p) => styleMatch(p, style)));
  if (rooms.length >= 2) {
    const colors = rooms.map((r) => new Set(r.products.flatMap((p) => words(p.color))));
    const pairs: number[] = [];
    colors.forEach((a, i) => {
      for (const b of colors.slice(i + 1)) {
        const union = new Set([...a, ...b]).size;
        if (union > 0) pairs.push([...a].filter((c) => b.has(c)).length / union);
      }
    });
    features.style_consistency = mean(pairs);
  }
  if (budgetCad !== undefined && budgetCad > 0) {
    const used = products.reduce((s, p) => s + p.priceCad, 0) / budgetCad;
    features.budget = used > 1 ? 0 : used >= 0.7 ? 1 : 0.5 + (0.5 * used) / 0.7;
  }
  return weigh(features, weights.home);
}

export type FurnitureScores = {
  /** Each room with furniture, by its id. */
  rooms: ReadonlyMap<string, Scored>;
  home: Scored;
};

/**
 * The home's furniture scored as it stands, after any edits (PLAN.md M5): each room with
 * furniture on its own, with the relations its intent asked for between the items that kept
 * their ref, then the home. Items placed by hand have no relations; items whose product isn't
 * known are left out.
 */
export function scoreFurniture(
  plan: LayoutPlan,
  furniture: readonly Placement[],
  products: ReadonlyMap<string, ScoredProduct>,
  options: { intents?: readonly RoomIntent[]; style?: StylePreset; budgetCad?: number } = {},
): FurnitureScores {
  const rooms = new Map<string, Scored>();
  const scored: HomeInput['rooms'][number][] = [];
  for (const roomId of new Set(furniture.map((f) => f.roomId))) {
    const ctx = roomContext(plan, roomId);
    if (!ctx) continue;
    const refs = new Set<string>();
    const pieces: Piece[] = [];
    for (const f of furniture) {
      const product = products.get(f.articleNo);
      if (f.roomId !== roomId || !product) continue;
      // An item without a ref of its own goes by its id, marked so it can't pass for one.
      const ref = f.ref && !refs.has(f.ref) ? f.ref : `#${f.id}`;
      refs.add(ref);
      pieces.push({ ref, placement: f, product });
    }
    if (pieces.length === 0) continue;
    const relations = options.intents?.find((i) => i.roomId === roomId)?.relations;
    const room = scoreRoom(ctx, pieces, { relations });
    rooms.set(roomId, room);
    scored.push({
      roomId,
      area: ctx.area,
      score: room.score,
      products: pieces.map((p) => p.product),
    });
  }
  const home = scoreHome({ rooms: scored, style: options.style, budgetCad: options.budgetCad });
  return { rooms, home };
}
