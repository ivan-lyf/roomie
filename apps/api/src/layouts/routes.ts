import { randomInt, randomUUID } from 'node:crypto';
import {
  FURNISHABLE,
  Floorplan,
  GenerationInputs,
  type GenerationJob,
  type LoggedIntent,
  Product,
  RoomAgain,
} from '@roomie/schema';
import { and, eq, inArray, or } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client';
import { floorplans, layouts, products } from '../db/schema';
import { readingCost } from '../plan-reader/claude';
import { furnishingOf } from './furnishing';
import { type Generation, generateHome, rearrangeRoom, type RoomStatus } from './generate';
import type { IntentWriter } from './intent';

export type LayoutOptions = {
  db: Db | undefined;
  /** Without one, homes are furnished by hand. */
  writer?: IntentWriter | undefined;
  /** Solver seeds per room; fewer in tests. */
  seeds?: number;
};

/** How a generation runs, told where to report its progress and each intent. */
type Run = (hooks: {
  onProgress: (rooms: RoomStatus[]) => void;
  onIntent: (intent: unknown) => void;
}) => Promise<Generation>;

/**
 * Furnish a home (PLAN.md M4): POST /floorplans/:id/layouts starts it and answers at once with
 * a generation id; GET /generations/:id says how each room is going, and what came of it.
 * Generations are kept in memory while the server runs; the layouts are kept for good.
 * POST /floorplans/:id/rooms/:roomId/layouts furnishes one room again, the rest of the home kept
 * as it stands, and GET /floorplans/:id/furnishing says what each room was last furnished from
 * (M5).
 */
export function layoutRoutes({ db, writer, seeds }: LayoutOptions) {
  const app = new Hono();
  const jobs = new Map<string, GenerationJob>();

  /** The plan, or why there's none to furnish. */
  async function planOf(c: Context, db: Db): Promise<Floorplan | Response> {
    const id = c.req.param('id')!;
    const [row] = z.uuid().safeParse(id).success
      ? await db.select().from(floorplans).where(eq(floorplans.id, id))
      : [];
    if (!row) return c.json({ error: 'No such floor plan.' }, 404);
    return Floorplan.parse(row);
  }

  const furnishes = (plan: Floorplan, roomId: string) => {
    const room = plan.rooms.find((r) => r.id === roomId);
    return room !== undefined && room.furnishable && FURNISHABLE.has(room.roomType);
  };

  /** The active catalog, and the products of the furniture in place, whatever their status. */
  async function catalogFor(db: Db, plan: Floorplan): Promise<Product[]> {
    const inPlace = [...new Set(plan.furniture.map((f) => f.articleNo))];
    const rows = await db
      .select()
      .from(products)
      .where(
        or(
          eq(products.status, 'active'),
          inPlace.length > 0 ? inArray(products.articleNo, inPlace) : undefined,
        ),
      );
    return z.array(Product).parse(rows);
  }

  /** Starts a generation in the background, and answers with its id. */
  function start(c: Context, db: Db, plan: Floorplan, inputs: GenerationInputs, run: Run) {
    const job: GenerationJob = {
      generationId: randomUUID(),
      floorplanId: plan.id,
      status: 'running',
      rooms: inputs.roomIds.map((roomId) => ({ roomId, status: 'waiting' })),
    };
    jobs.set(job.generationId, job);
    void furnish(db, plan, inputs, job, run);
    return c.json({ generationId: job.generationId }, 202);
  }

  /** One home is furnished one way at a time, so two results can't overwrite each other. */
  const busy = (planId: string) =>
    [...jobs.values()].some((j) => j.floorplanId === planId && j.status === 'running');

  app.post('/floorplans/:id/layouts', async (c) => {
    if (!db) return c.json({ error: 'DATABASE_URL is not set' }, 503);
    if (!writer) {
      return c.json({ error: 'No CLAUDE_API_KEY is set, so homes are furnished by hand.' }, 503);
    }
    const plan = await planOf(c, db);
    if (plan instanceof Response) return plan;
    if (!plan.scale) return c.json({ error: 'The plan needs its size set first.' }, 409);
    const inputs = GenerationInputs.safeParse(await c.req.json().catch(() => undefined));
    if (!inputs.success) return c.json({ error: z.prettifyError(inputs.error) }, 400);
    for (const roomId of inputs.data.roomIds) {
      if (!furnishes(plan, roomId)) {
        return c.json({ error: `Room ${roomId} isn't one that gets furniture.` }, 400);
      }
    }
    if (busy(plan.id)) return c.json({ error: 'This home is being furnished already.' }, 409);
    const catalog = await catalogFor(db, plan);
    return start(c, db, plan, inputs.data, (hooks) =>
      generateHome(plan, inputs.data, {
        writer,
        catalog,
        ...hooks,
        ...(seeds !== undefined && { seeds }),
      }),
    );
  });

  app.post('/floorplans/:id/rooms/:roomId/layouts', async (c) => {
    if (!db) return c.json({ error: 'DATABASE_URL is not set' }, 503);
    const plan = await planOf(c, db);
    if (plan instanceof Response) return plan;
    if (!plan.scale) return c.json({ error: 'The plan needs its size set first.' }, 409);
    const roomId = c.req.param('roomId');
    if (!furnishes(plan, roomId)) {
      return c.json({ error: `Room ${roomId} isn't one that gets furniture.` }, 400);
    }
    const again = RoomAgain.safeParse(await c.req.json().catch(() => undefined));
    if (!again.success) return c.json({ error: z.prettifyError(again.error) }, 400);
    const now = plan.furniture.filter((f) => f.roomId === roomId);
    if (again.data.mode === 'rearrange' && now.length === 0) {
      return c.json({ error: "There's nothing in the room to rearrange." }, 400);
    }
    if (again.data.mode === 'new_pieces' && !writer) {
      return c.json({ error: 'No CLAUDE_API_KEY is set, so rooms are furnished by hand.' }, 503);
    }
    if (busy(plan.id)) return c.json({ error: 'This home is being furnished already.' }, 409);

    const catalog = await catalogFor(db, plan);
    const keep = plan.furniture.filter((f) => f.roomId !== roomId);
    const furnishing = furnishingOf(new Set([roomId]), await winnersOf(db, plan.id));
    const last = furnishing.rooms[0];
    const options = { catalog, keep, ...(seeds !== undefined && { seeds }) };

    if (again.data.mode === 'new_pieces') {
      const { budgetCad, style, mustHaves } = again.data;
      const inputs = { roomIds: [roomId], budgetCad, style, mustHaves: { [roomId]: mustHaves } };
      return start(c, db, plan, inputs, (hooks) =>
        generateHome(plan, inputs, { writer: writer!, ...options, ...hooks }),
      );
    }
    const prices = new Map(catalog.map((p) => [p.articleNo, p.priceCad]));
    const total = now.reduce((s, f) => s + (prices.get(f.articleNo) ?? 0), 0);
    const inputs: GenerationInputs = {
      roomIds: [roomId],
      // What the room's items cost: nothing is left out for the budget.
      budgetCad: Math.max(1, Math.ceil(total)),
      style: furnishing.style ?? 'scandinavian',
      mustHaves: {},
    };
    const [reused] = last
      ? await db
          .select({ promptVersion: layouts.promptVersion })
          .from(layouts)
          .where(eq(layouts.id, last.layoutId))
      : [];
    return start(c, db, plan, inputs, ({ onProgress }) =>
      rearrangeRoom(plan, inputs, {
        ...options,
        onProgress,
        firstSeed: randomInt(1, 2 ** 30),
        ...(last && { intent: last.intent }),
        ...(reused && { promptVersion: reused.promptVersion }),
      }),
    );
  });

  app.get('/floorplans/:id/furnishing', async (c) => {
    if (!db) return c.json({ error: 'DATABASE_URL is not set' }, 503);
    const plan = await planOf(c, db);
    if (plan instanceof Response) return plan;
    const winners = await winnersOf(db, plan.id);
    return c.json(furnishingOf(new Set(plan.rooms.map((r) => r.id)), winners));
  });

  app.get('/generations/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    return job ? c.json(job) : c.json({ error: 'No such furnishing.' }, 404);
  });

  return app;
}

/** A home's winning layouts, as logged. */
function winnersOf(db: Db, floorplanId: string) {
  return db
    .select({
      id: layouts.id,
      inputs: layouts.inputs,
      llmIntent: layouts.llmIntent,
      placements: layouts.placements,
      createdAt: layouts.createdAt,
    })
    .from(layouts)
    .where(and(eq(layouts.floorplanId, floorplanId), eq(layouts.status, 'winner')));
}

/**
 * Runs one generation: logs every candidate and the winner as layouts, and makes the winner the
 * home's furniture. The job says how it's going.
 */
async function furnish(
  db: Db,
  plan: Floorplan,
  inputs: GenerationInputs,
  job: GenerationJob,
  run: Run,
) {
  let intent: unknown;
  try {
    const home = await run({
      onIntent: (i) => (intent = i),
      onProgress: (rooms) => (job.rooms = rooms.map((r) => ({ ...r }))),
    });
    const llmIntent: LoggedIntent = {
      intent: home.intent,
      mode: home.mode,
      model: home.model,
      usage: home.usage,
      repairs: home.repairs,
      seeds: home.seeds,
    };
    const row = (candidate: (typeof home.candidates)[number], status: 'candidate' | 'winner') => ({
      floorplanId: plan.id,
      generationId: job.generationId,
      inputs,
      placements: candidate.placements,
      score: candidate.score,
      scoreBreakdown: candidate.breakdown,
      llmIntent,
      promptVersion: home.promptVersion,
      status,
    });
    const [winner] = await db.insert(layouts).values(row(home.winner, 'winner')).returning();
    if (home.candidates.length > 0) {
      await db.insert(layouts).values(home.candidates.map((c) => row(c, 'candidate')));
    }
    await db
      .update(floorplans)
      .set({ furniture: home.winner.placements, furnishedFrom: winner!.id, updatedAt: new Date() })
      .where(eq(floorplans.id, plan.id));
    const cost = home.model === null ? 0 : readingCost(home.model, home.usage);
    Object.assign(job, {
      status: 'done',
      layoutId: winner!.id,
      furniture: home.winner.placements,
      ...(cost !== undefined && { costUsd: cost }),
    });
  } catch (e) {
    job.status = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
    // Enough to reproduce it offline without paying for the intent again.
    console.error(
      `Furnishing ${job.generationId} of ${plan.id} failed:`,
      e,
      JSON.stringify({ inputs, intent }),
    );
  }
}
