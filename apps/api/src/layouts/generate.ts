import {
  anchorOf,
  type LayoutProblem,
  type RoomWeights,
  roomContext,
  type RoomSolution,
  type Scored,
  type SolveOptions,
  scoreHome,
  scoreRoom,
  solveRoom,
  validateLayout,
} from '@roomie/geometry';
import {
  type Category,
  type Floorplan,
  type FurnishMode,
  type GenerationInputs,
  type IntentItem,
  type LayoutIntent,
  type Placement,
  type Product,
  type Relation,
  relationRefs,
  type RoomIntent,
  type RoomProgress,
} from '@roomie/schema';
import type { ReaderUsage } from '../plan-reader/reader';
import type { RoomReviser } from '../ratings/revise';
import { pickCandidates, shortName } from './candidates';
import {
  type IntentRequest,
  type IntentResult,
  type IntentWriter,
  LAYOUT_ROOM_PROMPT,
} from './intent';

// One furnishing (PLAN.md M4, M5): the LLM's intent, each room solved with N seeds, failed rooms
// sent back for repair at most twice, then the best of each room combined into the winner.
// Nothing invalid comes out: what still doesn't fit is left out, and said so. Some rooms can be
// furnished again around the rest of the home as it stands, or only rearranged, with no LLM.

/** Solver seeds per room: the best-of-N. */
export const SEEDS = 8;
/** How many times failed rooms go back to the LLM. */
export const REPAIRS = 2;

/** What goes first when a home is over budget: the least needed. */
const DROP_FIRST: Category[] = [
  'floor_lamp',
  'rug',
  'shelving',
  'armchair',
  'dresser',
  'tv_unit',
  'nightstand',
  'desk_chair',
  'coffee_table',
  'dining_chair',
  'wardrobe',
  'desk',
  'dining_table',
  'sofa',
  'bed',
];

export type RoomStatus = RoomProgress;

/** One way to furnish the home: placements with unique ids, and its score. */
export type HomeCandidate = { placements: Placement[] } & Scored;

export type Generation = {
  mode: FurnishMode;
  intent: LayoutIntent;
  /** The LLM that wrote the intent; none for a rearrange. */
  model: string | null;
  promptVersion: string;
  usage: ReaderUsage;
  repairs: number;
  /** The solver seeds tried. */
  seeds: number[];
  /** A revision's original layout (M7). */
  parent?: string;
  /** The name of the weights items were placed by, when they weren't weights.json's (M7). */
  weights?: string;
  /** Every candidate, one per seed, for the log: the whole home, rooms kept included. */
  candidates: HomeCandidate[];
  /** Each room's best, combined with the rooms kept: what the home gets. */
  winner: HomeCandidate;
  rooms: RoomStatus[];
};

type SolveDeps = {
  /**
   * The active catalog to choose from, and the products of the furniture already in place,
   * whatever their status: only active ones are offered.
   */
  catalog: readonly Product[];
  seeds?: number;
  onProgress?: (rooms: RoomStatus[]) => void;
  signal?: AbortSignal;
  /**
   * The furniture of every room not being furnished, which they're solved around and which
   * doesn't change (M5). Without it, the whole home is furnished afresh.
   */
  keep?: readonly Placement[];
  /** Other weights to place items by than weights.json's, by name (comparing them, M7). */
  weights?: { name: string; room: RoomWeights };
};

export type GenerateDeps = SolveDeps & {
  writer: IntentWriter;
  /** The first of the seeds to try, 1 unless more layouts of the same intent are wanted (M7). */
  firstSeed?: number;
  /** Each intent as it comes, to log if what follows fails. */
  onIntent?: (intent: LayoutIntent) => void;
  /** What each LLM call used as it comes, to log if what follows fails. */
  onUsage?: (usage: ReaderUsage) => void;
};

/** Lets other work on the server run before going on. */
const pause = () => new Promise<void>((resolve) => setImmediate(resolve));

const addUsage = (a: ReaderUsage, b: ReaderUsage): ReaderUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

/** The better of two solutions of a room: fewer items left out, then a higher score. */
const better = (a: RoomSolution, b: RoomSolution) =>
  a.unplaced.length - b.unplaced.length || b.score - a.score;

/** Gives a solved item, whose id is its ref, its id in the home and the ref it keeps. */
type Identify = (placement: Placement) => Pick<Placement, 'id' | 'ref'>;

/**
 * Ids for new items, unique in the home: f1, f2, and so on, or, furnishing some rooms again,
 * after the highest the home has used, so no id comes back meaning another item. Each item
 * keeps the intent's ref it was solved under.
 */
function newIds(plan: Floorplan, again: boolean): () => Identify {
  const used = plan.furniture.map((f) => Number(/^f(\d+)$/.exec(f.id)?.[1] ?? 0));
  const first = again ? Math.max(0, ...used) + 1 : 1;
  return () => {
    let n = first;
    return (p) => ({ id: `f${n++}`, ref: p.id });
  };
}

/** Each room with every seed, one after another, each around what's chosen before it. */
async function solveRooms(
  plan: Floorplan,
  intent: LayoutIntent,
  roomIds: readonly string[],
  products: ReadonlyMap<string, Product>,
  seeds: readonly number[],
  keep: readonly Placement[],
  options: Pick<SolveOptions, 'avoid' | 'placeAll' | 'weights'> = {},
): Promise<Map<string, RoomSolution[]>> {
  const solved = new Map<string, RoomSolution[]>();
  // Rooms open to each other share walkways, so each is solved around the rooms kept and the
  // best of the rooms before it, with ids marked so they can't pass for its refs.
  const others: Placement[] = keep.map((p) => ({ ...p, id: `kept:${p.id}` }));
  for (const roomId of roomIds) {
    const room = intent.rooms.find((r) => r.roomId === roomId);
    const runs: RoomSolution[] = [];
    for (const seed of room ? seeds : []) {
      // Solving takes a moment per try: let the server answer other requests in between.
      await pause();
      runs.push(solveRoom(plan, room!, products, { ...options, seed, others }));
    }
    solved.set(roomId, runs);
    const best = runs.toSorted(better)[0];
    if (best) others.push(...best.placements.map((p) => ({ ...p, id: `${roomId}:${p.id}` })));
  }
  return solved;
}

export async function generateHome(
  plan: Floorplan,
  inputs: GenerationInputs,
  deps: GenerateDeps,
): Promise<Generation> {
  const products = new Map(deps.catalog.map((p) => [p.articleNo, p]));
  const again = deps.keep !== undefined;
  const keep = deps.keep ?? [];
  const request: IntentRequest = {
    plan,
    inputs,
    candidates: pickCandidates(plan, deps.catalog, inputs),
    ...(again && {
      again: {
        kept: keep,
        now: plan.furniture.filter((f) => inputs.roomIds.includes(f.roomId)),
        products,
      },
    }),
  };
  const first = deps.firstSeed ?? 1;
  const seeds = Array.from({ length: deps.seeds ?? SEEDS }, (_, i) => first + i);
  deps.onProgress?.(inputs.roomIds.map((roomId) => ({ roomId, status: 'waiting' })));

  let result: IntentResult = await deps.writer.write(request, deps.signal);
  let usage = result.usage;
  let repairs = 0;
  let solved: Map<string, RoomSolution[]>;
  deps.onUsage?.(result.usage);
  deps.onIntent?.(result.intent);
  for (;;) {
    solved = await solveRooms(plan, result.intent, inputs.roomIds, products, seeds, keep, {
      weights: deps.weights?.room,
    });
    const feedback = problemsOf(plan, inputs, solved, products);
    if (feedback.length === 0 || repairs >= REPAIRS) break;
    repairs++;
    result = await deps.writer.repair(result, request, feedback.join('\n'), deps.signal);
    usage = addUsage(usage, result.usage);
    deps.onUsage?.(result.usage);
    deps.onIntent?.(result.intent);
  }

  const outcome = combine(
    plan,
    inputs,
    result.intent,
    solved,
    products,
    keep,
    newIds(plan, again),
    deps.weights?.room,
  );
  deps.onProgress?.(outcome.rooms);
  return {
    mode: again ? 'new_pieces' : 'home',
    intent: result.intent,
    model: result.model,
    promptVersion: again
      ? `${deps.writer.promptVersion}+${LAYOUT_ROOM_PROMPT.version}`
      : deps.writer.promptVersion,
    usage,
    repairs,
    seeds,
    ...(deps.weights && { weights: deps.weights.name }),
    ...outcome,
  };
}

export type RearrangeDeps = SolveDeps & {
  keep: readonly Placement[];
  /** The first of the seeds to try: drawn at random, so each rearrange is another. */
  firstSeed: number;
  /** The intent the room was last furnished from, if it was. */
  intent?: RoomIntent;
  /** That intent's prompt version, logged with the layout. */
  promptVersion?: string;
};

/**
 * The intent to rearrange a room by: the items it holds now, by the refs they kept, and the
 * relations of its last intent that still apply. An item without a ref of its own (placed by
 * hand, or furnished before refs were kept) takes the ref of a product the intent chose that
 * it is, if one is left; otherwise it gets one made up, which it doesn't keep.
 */
export function rearrangeIntent(
  roomId: string,
  items: readonly Placement[],
  last: RoomIntent | undefined,
): { intent: RoomIntent; byRef: Map<string, Placement>; madeUp: Set<string> } {
  const byRef = new Map<string, Placement>();
  const madeUp = new Set<string>();
  const own = new Set(items.flatMap((f) => f.ref ?? []));
  const left = (last?.items ?? []).filter((i) => !own.has(i.ref));
  const chosen: IntentItem[] = [];
  for (const item of items) {
    let ref = item.ref && !byRef.has(item.ref) ? item.ref : undefined;
    if (!ref) {
      const same = left.findIndex((i) => i.articleNo === item.articleNo);
      if (same >= 0) ref = left.splice(same, 1)[0]!.ref;
    }
    if (!ref) {
      ref = `item_${item.id}`.toLowerCase();
      madeUp.add(ref);
    }
    byRef.set(ref, item);
    const why = last?.items.find((i) => i.ref === ref && i.articleNo === item.articleNo)?.why;
    chosen.push({ ref, articleNo: item.articleNo, why: why ?? '' });
  }
  const relations: Relation[] = (last?.relations ?? []).filter((r) =>
    relationRefs(r).every((ref) => byRef.has(ref)),
  );
  return { intent: { roomId, items: chosen, relations }, byRef, madeUp };
}

/**
 * Lays a room's items out afresh (M5): the same items, solved again with new seeds, keeping the
 * relations its intent asked for, around the rest of the home as it stands. No LLM, so it costs
 * nothing. The room's largest piece that stands on its own leaves where it is, so each rearrange
 * is another layout; every item must find a spot, or the room stays as it was.
 */
export async function rearrangeRoom(
  plan: Floorplan,
  inputs: GenerationInputs,
  deps: RearrangeDeps,
): Promise<Generation> {
  const products = new Map(deps.catalog.map((p) => [p.articleNo, p]));
  const roomId = inputs.roomIds[0]!;
  const now = plan.furniture.filter((f) => f.roomId === roomId);
  const { intent: room, byRef, madeUp } = rearrangeIntent(roomId, now, deps.intent);
  const intent: LayoutIntent = {
    rooms: [room],
    budget: [{ roomId, cad: inputs.budgetCad }],
    notes: '',
  };
  const seeds = Array.from({ length: deps.seeds ?? SEEDS }, (_, i) => deps.firstSeed + i);
  deps.onProgress?.([{ roomId, status: 'waiting' }]);

  const area = (ref: string) => {
    const dims = products.get(byRef.get(ref)!.articleNo)?.dims;
    return dims ? dims.w * dims.d : 0;
  };
  const main = room.items
    .map((i) => i.ref)
    .filter((ref) => anchorOf(ref, room.relations) === undefined)
    .sort((a, b) => area(b) - area(a))[0];
  const avoid = main ? [{ ...byRef.get(main)!, id: main }] : [];
  const solved = await solveRooms(plan, intent, [roomId], products, seeds, deps.keep, {
    avoid,
    placeAll: true,
  });
  // Nothing the room has is left out of it.
  const whole = solved.get(roomId)!.filter((run) => run.unplaced.length === 0);
  if (whole.length === 0) {
    const name = plan.rooms.find((r) => r.id === roomId)?.name ?? roomId;
    throw new Error(`There's no other way to fit everything in the ${name}.`);
  }
  solved.set(roomId, whole);

  // Rearranged items stay the items they were, with their ids, and the refs they were solved
  // under unless those were made up.
  const identify = () => (p: Placement) => {
    const { id } = byRef.get(p.id)!;
    return madeUp.has(p.id) ? { id } : { id, ref: p.id };
  };
  const outcome = combine(plan, inputs, intent, solved, products, deps.keep, identify);
  deps.onProgress?.(outcome.rooms);
  return {
    mode: 'rearrange',
    intent,
    model: null,
    promptVersion: deps.promptVersion ?? 'none',
    usage: { inputTokens: 0, outputTokens: 0 },
    repairs: 0,
    seeds,
    ...outcome,
  };
}

export type ReviseDeps = Pick<SolveDeps, 'catalog' | 'signal'> & {
  reviser: RoomReviser;
  /** The layout revised: the whole home, as logged. */
  layout: { id: string; placements: readonly Placement[]; seeds: readonly number[] };
  /** The intent its room was furnished from. */
  intent: RoomIntent;
  /** What should change, in the rater's words. */
  words: string;
  onUsage?: (usage: ReaderUsage) => void;
};

/**
 * Revises one room of a logged layout from what a rater said ("Tell it", M7): the LLM changes the
 * room's intent, with the pieces it has, and the solver places that with the layout's seeds,
 * around the rest of the home as the layout had it. Items keep their ids, and nothing is left
 * out that fits. Answers the revision as a generation, and what of the words couldn't be done.
 */
export async function reviseRoom(
  plan: Floorplan,
  inputs: GenerationInputs,
  deps: ReviseDeps,
): Promise<Generation & { cannot: string | null }> {
  const products = new Map(deps.catalog.map((p) => [p.articleNo, p]));
  const roomId = inputs.roomIds[0]!;
  const now = deps.layout.placements.filter((p) => p.roomId === roomId);
  const keep = deps.layout.placements.filter((p) => p.roomId !== roomId);
  const revised = await deps.reviser.revise(
    { plan, intent: deps.intent, placements: now, products, words: deps.words },
    deps.signal,
  );
  deps.onUsage?.(revised.usage);
  const intent: LayoutIntent = {
    rooms: [revised.intent],
    budget: [{ roomId, cad: inputs.budgetCad }],
    notes: revised.cannot ?? '',
  };
  const seeds = [...deps.layout.seeds];
  const solved = await solveRooms(plan, intent, [roomId], products, seeds, keep, {
    placeAll: true,
  });

  // Items keep the ids they had under the same ref; one without a ref gets a new id.
  const byRef = new Map(now.flatMap((p) => (p.ref ? [[p.ref, p.id] as const] : [])));
  const fresh = newIds({ ...plan, furniture: [...deps.layout.placements] }, true);
  const identify = () => {
    const next = fresh();
    return (p: Placement) => {
      const id = byRef.get(p.id);
      return id ? { id, ref: p.id } : next(p);
    };
  };
  const outcome = combine(plan, inputs, intent, solved, products, keep, identify);
  return {
    mode: 'revise',
    intent,
    model: revised.model,
    promptVersion: deps.reviser.promptVersion,
    usage: revised.usage,
    repairs: 0,
    seeds,
    parent: deps.layout.id,
    cannot: revised.cannot,
    ...outcome,
  };
}

/** A problem, to know the same one before and after the rooms furnished join the home. */
const problemKey = (p: LayoutProblem) => `${p.code}|${p.ids.join(',')}|${p.roomId ?? ''}`;

/**
 * The rooms furnished, chosen and combined with those kept: the best of each room, trimmed to
 * the budget, checked whole. Problems the rooms kept already had don't count against it; only
 * those the rooms furnished bring do.
 */
function combine(
  plan: Floorplan,
  inputs: GenerationInputs,
  intent: LayoutIntent,
  solved: Map<string, RoomSolution[]>,
  products: ReadonlyMap<string, Product>,
  keep: readonly Placement[],
  ids: () => Identify,
  /** Other weights than weights.json's, to score a room trimmed for the budget again by. */
  weights?: RoomWeights,
): Pick<Generation, 'candidates' | 'winner' | 'rooms'> {
  const before = new Set(validateLayout(plan, keep, products).map(problemKey));
  const brought = (placements: readonly Placement[]) =>
    validateLayout(plan, placements, products).filter((p) => !before.has(problemKey(p)));
  const bestOf = (roomId: string) => solved.get(roomId)!.toSorted(better)[0];
  const area = (roomId: string) => roomContext(plan, roomId)?.area ?? 0;
  const homeOf = (chosen: readonly RoomSolution[]): HomeCandidate => {
    const identify = ids();
    const placed = chosen.flatMap((r) => r.placements).map((p) => ({ ...p, ...identify(p) }));
    const scored = scoreHome({
      rooms: chosen.map((r) => ({
        roomId: r.roomId,
        area: area(r.roomId),
        score: r.score,
        products: r.placements.map((p) => products.get(p.articleNo)!),
      })),
      style: inputs.style,
      budgetCad: inputs.budgetCad,
    });
    const breakdown = { ...scored.breakdown };
    for (const r of chosen) {
      for (const [k, v] of Object.entries(r.breakdown)) breakdown[`${r.roomId}.${k}`] = v;
    }
    return { placements: [...keep, ...placed], score: scored.score, breakdown };
  };

  // Each seed's rooms together, as long as they stand together: only valid layouts are logged.
  const tries = Math.max(0, ...[...solved.values()].map((runs) => runs.length));
  const candidates = Array.from({ length: tries }, (_, i) =>
    homeOf(inputs.roomIds.flatMap((id) => solved.get(id)![i] ?? [])),
  ).filter((c) => brought(c.placements).length === 0);
  let chosen = inputs.roomIds.flatMap((id) => bestOf(id) ?? []);
  const dropped = trimToBudget(chosen, inputs.budgetCad, products);
  // A room that lost items to the budget is scored again as it now stands.
  chosen = dropped.rooms.map((room, i) => {
    if (room.placements.length === chosen[i]!.placements.length) return room;
    const ctx = roomContext(plan, room.roomId)!;
    const relations = intent.rooms.find((r) => r.roomId === room.roomId)?.relations;
    const pieces = room.placements.map((p) => ({
      ref: p.id,
      placement: p,
      product: products.get(p.articleNo)!,
    }));
    return { ...room, ...scoreRoom(ctx, pieces, { relations, weights }) };
  });
  const winner = homeOf(chosen);
  // Rooms are solved apart, but the whole home is checked once more before it ships.
  const problems = brought(winner.placements);
  if (problems.length > 0) {
    throw new Error(`The combined layout isn't valid: ${problems.map((p) => p.message).join(' ')}`);
  }

  const rooms = inputs.roomIds.map((roomId): RoomStatus => {
    const best = bestOf(roomId);
    const reasons = [
      ...(best ? best.unplaced.map((u) => u.reason) : ["It wasn't furnished."]),
      ...dropped.reasons.filter((d) => d.roomId === roomId).map((d) => d.reason),
    ];
    return {
      roomId,
      status: best && best.placements.length > 0 ? 'done' : 'failed',
      ...(reasons.length > 0 && { reasons }),
    };
  });
  return { candidates, winner, rooms };
}

/** What to tell the LLM went wrong: items the solver couldn't place, and a budget overrun. */
function problemsOf(
  plan: Floorplan,
  inputs: GenerationInputs,
  solved: Map<string, RoomSolution[]>,
  products: ReadonlyMap<string, Product>,
): string[] {
  const problems: string[] = [];
  let total = 0;
  for (const roomId of inputs.roomIds) {
    const best = solved.get(roomId)!.toSorted(better)[0];
    const name = plan.rooms.find((r) => r.id === roomId)?.name ?? roomId;
    if (!best) {
      problems.push(`${name} (${roomId}) has no items.`);
      continue;
    }
    for (const u of best.unplaced) problems.push(`In ${name} (${roomId}), ${u.ref}: ${u.reason}`);
    total += best.placements.reduce((s, p) => s + (products.get(p.articleNo)?.priceCad ?? 0), 0);
  }
  if (total > inputs.budgetCad) {
    problems.push(
      `What fits costs $${total.toFixed(0)}, over the $${inputs.budgetCad.toFixed(0)} budget.`,
    );
  }
  return problems;
}

/**
 * Leaves out the least needed items, one at a time, until the home is within budget. Taking an
 * item away never makes a valid layout invalid.
 */
function trimToBudget(
  rooms: readonly RoomSolution[],
  budgetCad: number,
  products: ReadonlyMap<string, Product>,
): { rooms: RoomSolution[]; reasons: { roomId: string; reason: string }[] } {
  const kept = rooms.map((r) => ({ ...r, placements: [...r.placements] }));
  const reasons: { roomId: string; reason: string }[] = [];
  const price = (p: Placement) => products.get(p.articleNo)?.priceCad ?? 0;
  let total = kept.flatMap((r) => r.placements).reduce((s, p) => s + price(p), 0);
  const order = (p: Placement) => DROP_FIRST.indexOf(products.get(p.articleNo)!.category);
  while (total > budgetCad) {
    const all = kept.flatMap((r) => r.placements.map((p) => ({ room: r, p })));
    if (all.length === 0) break;
    const { room, p } = all.sort((a, b) => order(a.p) - order(b.p) || price(b.p) - price(a.p))[0]!;
    room.placements = room.placements.filter((q) => q !== p);
    total -= price(p);
    reasons.push({
      roomId: room.roomId,
      reason:
        `The ${shortName(products.get(p.articleNo)!.name)} was left out ` +
        'to stay within budget.',
    });
  }
  return { rooms: kept, reasons };
}
