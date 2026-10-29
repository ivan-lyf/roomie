import { randomUUID } from 'node:crypto';
import {
  FURNISHABLE,
  Floorplan,
  GenerationInputs,
  type GenerationJob,
  type LoggedIntent,
  Product,
} from '@roomie/schema';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client';
import { floorplans, layouts, products } from '../db/schema';
import { readingCost } from '../plan-reader/claude';
import { furnishingOf } from './furnishing';
import { generateHome } from './generate';
import type { IntentWriter } from './intent';

export type LayoutOptions = {
  db: Db | undefined;
  /** Without one, homes are furnished by hand. */
  writer?: IntentWriter | undefined;
  /** Solver seeds per room; fewer in tests. */
  seeds?: number;
};

/**
 * Furnish a home (PLAN.md M4): POST /floorplans/:id/layouts starts it and answers at once with
 * a generation id; GET /generations/:id says how each room is going, and what came of it.
 * Generations are kept in memory while the server runs; the layouts are kept for good.
 * GET /floorplans/:id/furnishing says what each room was last furnished from (M5).
 */
export function layoutRoutes({ db, writer, seeds }: LayoutOptions) {
  const app = new Hono();
  const jobs = new Map<string, GenerationJob>();

  app.post('/floorplans/:id/layouts', async (c) => {
    if (!db) return c.json({ error: 'DATABASE_URL is not set' }, 503);
    if (!writer) {
      return c.json({ error: 'No CLAUDE_API_KEY is set, so homes are furnished by hand.' }, 503);
    }
    const id = c.req.param('id');
    const [row] = z.uuid().safeParse(id).success
      ? await db.select().from(floorplans).where(eq(floorplans.id, id))
      : [];
    if (!row) return c.json({ error: 'No such floor plan.' }, 404);
    const plan = Floorplan.parse(row);
    if (!plan.scale) return c.json({ error: 'The plan needs its size set first.' }, 409);
    const inputs = GenerationInputs.safeParse(await c.req.json().catch(() => undefined));
    if (!inputs.success) return c.json({ error: z.prettifyError(inputs.error) }, 400);
    for (const roomId of inputs.data.roomIds) {
      const room = plan.rooms.find((r) => r.id === roomId);
      if (!room || !room.furnishable || !FURNISHABLE.has(room.roomType)) {
        return c.json({ error: `Room ${roomId} isn't one that gets furniture.` }, 400);
      }
    }
    const catalog = z
      .array(Product)
      .parse(await db.select().from(products).where(eq(products.status, 'active')));

    const job: GenerationJob = {
      generationId: randomUUID(),
      floorplanId: plan.id,
      status: 'running',
      rooms: inputs.data.roomIds.map((roomId) => ({ roomId, status: 'waiting' })),
    };
    jobs.set(job.generationId, job);
    void furnish(db, writer, plan, inputs.data, catalog, job, seeds);
    return c.json({ generationId: job.generationId }, 202);
  });

  app.get('/floorplans/:id/furnishing', async (c) => {
    if (!db) return c.json({ error: 'DATABASE_URL is not set' }, 503);
    const id = c.req.param('id');
    const [row] = z.uuid().safeParse(id).success
      ? await db.select().from(floorplans).where(eq(floorplans.id, id))
      : [];
    if (!row) return c.json({ error: 'No such floor plan.' }, 404);
    const plan = Floorplan.parse(row);
    const winners = await db
      .select({
        id: layouts.id,
        inputs: layouts.inputs,
        llmIntent: layouts.llmIntent,
        createdAt: layouts.createdAt,
      })
      .from(layouts)
      .where(and(eq(layouts.floorplanId, id), eq(layouts.status, 'winner')));
    return c.json(furnishingOf(new Set(plan.rooms.map((r) => r.id)), winners));
  });

  app.get('/generations/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    return job ? c.json(job) : c.json({ error: 'No such furnishing.' }, 404);
  });

  return app;
}

/**
 * Runs one generation: logs every candidate and the winner as layouts, and makes the winner the
 * home's furniture. The job says how it's going.
 */
async function furnish(
  db: Db,
  writer: IntentWriter,
  plan: Floorplan,
  inputs: GenerationInputs,
  catalog: Product[],
  job: GenerationJob,
  seeds: number | undefined,
) {
  let intent: unknown;
  try {
    const home = await generateHome(plan, inputs, {
      writer,
      catalog,
      onIntent: (i) => (intent = i),
      ...(seeds !== undefined && { seeds }),
      onProgress: (rooms) => (job.rooms = rooms.map((r) => ({ ...r }))),
    });
    const llmIntent: LoggedIntent = {
      intent: home.intent,
      mode: 'home',
      model: home.model,
      usage: home.usage,
      repairs: home.repairs,
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
    const cost = readingCost(home.model, home.usage);
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
