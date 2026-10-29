import {
  roomContext,
  type RoomSolution,
  type Scored,
  scoreHome,
  scoreRoom,
  solveRoom,
  validateLayout,
} from '@roomie/geometry';
import type {
  Category,
  Floorplan,
  GenerationInputs,
  LayoutIntent,
  Placement,
  Product,
  RoomProgress,
} from '@roomie/schema';
import type { ReaderUsage } from '../plan-reader/reader';
import { pickCandidates, shortName } from './candidates';
import type { IntentRequest, IntentResult, IntentWriter } from './intent';

// One furnishing of a home (PLAN.md M4): the LLM's intent, each room solved with N seeds, failed
// rooms sent back for repair at most twice, then the best of each room combined into the winner.
// Nothing invalid comes out: what still doesn't fit is left out, and said so.

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
  intent: LayoutIntent;
  model: string;
  promptVersion: string;
  usage: ReaderUsage;
  repairs: number;
  /** Every candidate, one per seed, for the log. */
  candidates: HomeCandidate[];
  /** Each room's best, combined: what the home gets. */
  winner: HomeCandidate;
  rooms: RoomStatus[];
};

export type GenerateDeps = {
  writer: IntentWriter;
  /** The active catalog. */
  catalog: readonly Product[];
  seeds?: number;
  onProgress?: (rooms: RoomStatus[]) => void;
  /** Each intent as it comes, to log if what follows fails. */
  onIntent?: (intent: LayoutIntent) => void;
  signal?: AbortSignal;
};

const addUsage = (a: ReaderUsage, b: ReaderUsage): ReaderUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

/** The better of two solutions of a room: fewer items left out, then a higher score. */
const better = (a: RoomSolution, b: RoomSolution) =>
  a.unplaced.length - b.unplaced.length || b.score - a.score;

/** Placements from several rooms, with ids unique in the home: f1, f2, and so on. */
function numbered(rooms: readonly RoomSolution[]): Placement[] {
  return rooms.flatMap((r) => r.placements).map((p, i) => ({ ...p, id: `f${i + 1}` }));
}

export async function generateHome(
  plan: Floorplan,
  inputs: GenerationInputs,
  deps: GenerateDeps,
): Promise<Generation> {
  const products = new Map(deps.catalog.map((p) => [p.articleNo, p]));
  const request: IntentRequest = {
    plan,
    inputs,
    candidates: pickCandidates(plan, deps.catalog, inputs),
  };
  const seeds = deps.seeds ?? SEEDS;
  const rooms: RoomStatus[] = inputs.roomIds.map((roomId) => ({ roomId, status: 'waiting' }));
  deps.onProgress?.(rooms);

  let result: IntentResult = await deps.writer.write(request, deps.signal);
  let usage = result.usage;
  let repairs = 0;
  let solved: Map<string, RoomSolution[]>;
  deps.onIntent?.(result.intent);
  for (;;) {
    solved = new Map();
    for (const roomId of inputs.roomIds) {
      const intent = result.intent.rooms.find((r) => r.roomId === roomId);
      const runs = intent
        ? Array.from({ length: seeds }, (_, i) =>
            solveRoom(plan, intent, products, { seed: i + 1 }),
          )
        : [];
      solved.set(roomId, runs);
    }
    const feedback = problemsOf(plan, inputs, solved, products);
    if (feedback.length === 0 || repairs >= REPAIRS) break;
    repairs++;
    result = await deps.writer.repair(result, request, feedback.join('\n'), deps.signal);
    usage = addUsage(usage, result.usage);
    deps.onIntent?.(result.intent);
  }

  const bestOf = (roomId: string) => solved.get(roomId)!.toSorted(better)[0];
  const area = (roomId: string) => roomContext(plan, roomId)?.area ?? 0;
  const homeOf = (chosen: readonly RoomSolution[]): HomeCandidate => {
    const placements = numbered(chosen);
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
    return { placements, score: scored.score, breakdown };
  };

  const candidates = Array.from({ length: seeds }, (_, i) =>
    homeOf(inputs.roomIds.flatMap((id) => solved.get(id)![i] ?? [])),
  );
  let chosen = inputs.roomIds.flatMap((id) => bestOf(id) ?? []);
  const dropped = trimToBudget(chosen, inputs.budgetCad, products);
  // A room that lost items to the budget is scored again as it now stands.
  chosen = dropped.rooms.map((room, i) => {
    if (room.placements.length === chosen[i]!.placements.length) return room;
    const ctx = roomContext(plan, room.roomId)!;
    const relations = result.intent.rooms.find((r) => r.roomId === room.roomId)?.relations;
    const pieces = room.placements.map((p) => ({
      ref: p.id,
      placement: p,
      product: products.get(p.articleNo)!,
    }));
    return { ...room, ...scoreRoom(ctx, pieces, { relations }) };
  });
  const winner = homeOf(chosen);
  // Rooms are solved apart, but the whole home is checked once more before it ships.
  const problems = validateLayout(plan, winner.placements, products);
  if (problems.length > 0) {
    throw new Error(`The combined layout isn't valid: ${problems.map((p) => p.message).join(' ')}`);
  }

  for (const status of rooms) {
    const best = bestOf(status.roomId);
    const reasons = [
      ...(best ? best.unplaced.map((u) => u.reason) : ["It wasn't furnished."]),
      ...dropped.reasons.filter((d) => d.roomId === status.roomId).map((d) => d.reason),
    ];
    status.status = best && best.placements.length > 0 ? 'done' : 'failed';
    if (reasons.length > 0) status.reasons = reasons;
  }
  deps.onProgress?.(rooms);

  return {
    intent: result.intent,
    model: result.model,
    promptVersion: deps.writer.promptVersion,
    usage,
    repairs,
    candidates,
    winner,
    rooms,
  };
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
