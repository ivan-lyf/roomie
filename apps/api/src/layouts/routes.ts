import { randomInt, randomUUID } from 'node:crypto';
import {
  FURNISHABLE,
  Floorplan,
  GenerationInputs,
  type GenerationJob,
  Product,
  RoomAgain,
} from '@roomie/schema';
import { and, eq, inArray, or } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { Allowance } from '../allowance';
import { type Account, accountOf, type Auth } from '../auth';
import type { Db } from '../db/client';
import { floorplans, layouts, products } from '../db/schema';
import { readingCost } from '../plan-reader/claude';
import { ReaderError, type ReaderUsage } from '../plan-reader/reader';
import { recordUsage } from '../usage';
import { furnishingOf } from './furnishing';
import { type Generation, generateHome, rearrangeRoom, type RoomStatus } from './generate';
import type { IntentWriter } from './intent';
import { logGeneration } from './log';

export type LayoutOptions = {
  db: Db | undefined;
  /** Without one, homes are furnished by hand. */
  writer?: IntentWriter | undefined;
  /** Solver seeds per room; fewer in tests. */
  seeds?: number;
  /** Who may have a home furnished by the LLM (PLAN.md M6); without it, nobody. */
  auth?: Auth | undefined;
  /** What each account may spend on LLM calls a day. */
  allowance?: Allowance | undefined;
};

/** How a generation runs, told where to report its progress, each intent and its usage. */
type Run = (hooks: {
  onProgress: (rooms: RoomStatus[]) => void;
  onIntent: (intent: unknown) => void;
  onUsage: (usage: ReaderUsage) => void;
}) => Promise<Generation>;

/** Who a generation's LLM calls are logged against and held for, and as what. */
type Billing = {
  account: Account;
  route: 'furnish_home' | 'new_pieces';
  model: string;
  allowance: Allowance | undefined;
};

/**
 * Furnish a home (PLAN.md M4): POST /floorplans/:id/layouts starts it and answers at once with
 * a generation id; GET /generations/:id says how each room is going, and what came of it.
 * Generations are kept in memory while the server runs; the layouts are kept for good.
 * POST /floorplans/:id/rooms/:roomId/layouts furnishes one room again, the rest of the home kept
 * as it stands, and GET /floorplans/:id/furnishing says what each room was last furnished from
 * (M5).
 */
export function layoutRoutes({ db, writer, seeds, auth, allowance }: LayoutOptions) {
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
  function start(
    c: Context,
    db: Db,
    plan: Floorplan,
    inputs: GenerationInputs,
    run: Run,
    billing?: Billing,
  ) {
    const job: GenerationJob = {
      generationId: randomUUID(),
      floorplanId: plan.id,
      status: 'running',
      rooms: inputs.roomIds.map((roomId) => ({ roomId, status: 'waiting' })),
    };
    jobs.set(job.generationId, job);
    void furnish(db, plan, inputs, job, run, billing);
    return c.json({ generationId: job.generationId }, 202);
  }

  /**
   * Lets an account within its allowance have the LLM furnish, holding it until the generation
   * ends; otherwise the response refusing it.
   */
  async function bill(
    c: Context,
    account: Account,
    route: Billing['route'],
    model: string,
  ): Promise<Billing | Response> {
    const refused = await allowance?.take(account, route, model);
    if (refused) return c.json(refused.refusal, refused.status);
    return { account, route, model, allowance };
  }

  /** One home is furnished one way at a time, so two results can't overwrite each other. */
  const busy = (planId: string) =>
    [...jobs.values()].some((j) => j.floorplanId === planId && j.status === 'running');

  app.post('/floorplans/:id/layouts', async (c) => {
    if (!db) return c.json({ error: 'DATABASE_URL is not set' }, 503);
    if (!writer) {
      return c.json({ error: 'No CLAUDE_API_KEY is set, so homes are furnished by hand.' }, 503);
    }
    const account = await accountOf(c, auth);
    if (account instanceof Response) return account;
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
    // Last: from here the account is held until the generation ends.
    const billing = await bill(c, account, 'furnish_home', writer.model);
    if (billing instanceof Response) return billing;
    return start(
      c,
      db,
      plan,
      inputs.data,
      (hooks) =>
        generateHome(plan, inputs.data, {
          writer,
          catalog,
          ...hooks,
          ...(seeds !== undefined && { seeds }),
        }),
      billing,
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
    // New pieces ask the LLM; a rearrange doesn't, so anyone may.
    const account = again.data.mode === 'new_pieces' ? await accountOf(c, auth) : undefined;
    if (account instanceof Response) return account;
    if (busy(plan.id)) return c.json({ error: 'This home is being furnished already.' }, 409);

    const catalog = await catalogFor(db, plan);
    const keep = plan.furniture.filter((f) => f.roomId !== roomId);
    const furnishing = furnishingOf(new Set([roomId]), await winnersOf(db, plan.id));
    const last = furnishing.rooms[0];
    const options = { catalog, keep, ...(seeds !== undefined && { seeds }) };

    if (again.data.mode === 'new_pieces') {
      const billing = await bill(c, account!, 'new_pieces', writer!.model);
      if (billing instanceof Response) return billing;
      const { budgetCad, style, mustHaves } = again.data;
      const inputs = { roomIds: [roomId], budgetCad, style, mustHaves: { [roomId]: mustHaves } };
      return start(
        c,
        db,
        plan,
        inputs,
        (hooks) => generateHome(plan, inputs, { writer: writer!, ...options, ...hooks }),
        billing,
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
 * home's furniture. The job says how it's going. What its LLM calls used is logged against the
 * account that asked, a failed generation's too, and the account is let go when it ends.
 */
async function furnish(
  db: Db,
  plan: Floorplan,
  inputs: GenerationInputs,
  job: GenerationJob,
  run: Run,
  billing?: Billing,
) {
  let intent: unknown;
  const used = { inputTokens: 0, outputTokens: 0 };
  const add = (usage: ReaderUsage | undefined) => {
    used.inputTokens += usage?.inputTokens ?? 0;
    used.outputTokens += usage?.outputTokens ?? 0;
  };
  try {
    const home = await run({
      onIntent: (i) => (intent = i),
      onProgress: (rooms) => (job.rooms = rooms.map((r) => ({ ...r }))),
      onUsage: add,
    });
    const winner = await logGeneration(db, plan.id, job.generationId, inputs, home);
    await db
      .update(floorplans)
      .set({ furniture: home.winner.placements, furnishedFrom: winner, updatedAt: new Date() })
      .where(eq(floorplans.id, plan.id));
    const cost = home.model === null ? 0 : readingCost(home.model, home.usage);
    Object.assign(job, {
      status: 'done',
      layoutId: winner,
      furniture: home.winner.placements,
      ...(cost !== undefined && { costUsd: cost }),
    });
  } catch (e) {
    job.status = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
    // An LLM call that failed still cost what it used.
    if (e instanceof ReaderError) add(e.usage);
    // Enough to reproduce it offline without paying for the intent again.
    console.error(
      `Furnishing ${job.generationId} of ${plan.id} failed:`,
      e,
      JSON.stringify({ inputs, intent }),
    );
  } finally {
    if (billing) {
      billing.allowance?.release(billing.account);
      const spent = { model: billing.model, usage: used, failed: job.status === 'failed' };
      await recordUsage(db, billing.account, billing.route, plan.id, spent).catch((e: unknown) =>
        console.error(`Logging the usage of ${job.generationId} failed:`, e),
      );
    }
  }
}
