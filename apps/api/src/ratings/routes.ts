import { roomScoreOf, type Scored } from '@roomie/geometry';
import {
  Floorplan,
  type NextPair,
  NoteLabel,
  type NoteReading,
  Placement,
  Product,
  Rating,
  RatingInput,
  type RatingSaved,
  type RatingSummary,
  type RatingWinner,
} from '@roomie/schema';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Allowance } from '../allowance';
import { type AccountEnv, type Auth, requireAdmin } from '../auth';
import type { Db } from '../db/client';
import { floorplans, layouts, products, ratings } from '../db/schema';
import { ReaderError } from '../plan-reader/reader';
import { recordUsage } from '../usage';
import { hasNotes, labelProblems, type NoteReader, type NoteRequest } from './notes';
import { pickPair, type Version } from './pairs';

export type RatingOptions = {
  db: Db | undefined;
  auth: Auth | undefined;
  /** The emails of the accounts that may rate. */
  admins: readonly string[];
  /** Draws the pairs; seeded in tests. */
  random?: () => number;
  /** Reads ratings' notes into labels; without one, notes are kept unread. */
  noteReader?: NoteReader | undefined;
  /** What each account may spend on LLM calls a day: reading notes counts. */
  allowance?: Allowance | undefined;
};

/** Room scores this close are a tie to the scorer. */
const TIE = 0.005;

/** Which of two rooms the scorer would pick. */
const scorerPick = (a: Pick<Scored, 'score'>, b: Pick<Scored, 'score'>): RatingWinner =>
  Math.abs(a.score - b.score) < TIE ? 'same' : a.score > b.score ? 'a' : 'b';

const Placements = z.array(Placement);
const NO_SCORE: Scored = { score: 0, breakdown: {} };

/**
 * The internal rating page's routes (PLAN.md M7), for admins only, mounted at /api/admin:
 * GET /ratings/next picks a pair, POST /ratings saves a rating and answers what the scorer would
 * have picked, POST /ratings/:id/archive takes one back (never deleted), and GET
 * /ratings/summary says how it's going. The pairs come from the test homes' layouts.
 * POST /ratings/:id/read has the rating's notes read into labels by the LLM, and PUT
 * /ratings/:id/labels saves the rater's corrections to them.
 */
export function ratingRoutes(options: RatingOptions) {
  const { db, auth, admins, random, noteReader, allowance } = options;
  const app = new Hono<AccountEnv>();
  app.use(requireAdmin(auth, admins));
  if (!db) {
    app.all('*', (c) => c.json({ error: 'DATABASE_URL is not set' }, 503));
    return app;
  }

  /** Every room of every layout of the test homes, with its score as logged. */
  async function pool(): Promise<Version[]> {
    const rows = await db!
      .select({
        id: layouts.id,
        floorplanId: layouts.floorplanId,
        placements: layouts.placements,
        breakdown: layouts.scoreBreakdown,
      })
      .from(layouts)
      .innerJoin(floorplans, eq(floorplans.id, layouts.floorplanId))
      .where(eq(floorplans.source, 'test_set'))
      // In a set order, so a layout that repeats another always gives way to the same one.
      .orderBy(layouts.createdAt, layouts.id);
    return rows.flatMap((row) => {
      const placements = Placements.parse(row.placements);
      return [...new Set(placements.map((p) => p.roomId))].flatMap((roomId) => {
        const scored = roomScoreOf(row.breakdown, roomId);
        if (!scored) return [];
        const room = placements.filter((p) => p.roomId === roomId);
        return [
          {
            layoutId: row.id,
            floorplanId: row.floorplanId,
            roomId,
            placements: room,
            score: scored.score,
          },
        ];
      });
    });
  }

  const active = () => db!.select().from(ratings).where(eq(ratings.status, 'active'));

  app.get('/ratings/next', async (c) => {
    const [versions, rated] = await Promise.all([pool(), active()]);
    const pair = pickPair(versions, rated, random);
    if (!pair) return c.json({ pair: null } satisfies NextPair);
    const [row] = await db!.select().from(floorplans).where(eq(floorplans.id, pair.floorplanId));
    const version = (v: Version) => ({ layoutId: v.layoutId, placements: [...v.placements] });
    return c.json({
      pair: {
        plan: Floorplan.parse(row),
        roomId: pair.roomId,
        a: version(pair.a),
        b: version(pair.b),
      },
    } satisfies NextPair);
  });

  app.post('/ratings', async (c) => {
    const parsed = RatingInput.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);
    const input = parsed.data;
    if (input.layoutA === input.layoutB) {
      return c.json({ error: 'Rate two different layouts.' }, 400);
    }
    const rows = await db!
      .select({
        id: layouts.id,
        floorplanId: layouts.floorplanId,
        placements: layouts.placements,
        breakdown: layouts.scoreBreakdown,
      })
      .from(layouts)
      .where(inArray(layouts.id, [input.layoutA, input.layoutB]));
    const [a, b] = [input.layoutA, input.layoutB].map((id) => rows.find((r) => r.id === id));
    if (!a || !b) return c.json({ error: 'No such layout.' }, 404);
    if (a.floorplanId !== b.floorplanId) {
      return c.json({ error: 'Rate two layouts of the same home.' }, 400);
    }
    const room = (row: typeof a) =>
      Placements.parse(row.placements).filter((p) => p.roomId === input.roomId);
    const items = { a: room(a), b: room(b) };
    if (items.a.length === 0 || items.b.length === 0) {
      return c.json({ error: 'Both layouts must have furniture in the room.' }, 400);
    }
    const strays = input.itemNotes.filter(
      (n) => !items[n.side].some((p) => p.id === n.placementId),
    );
    if (strays.length > 0) {
      return c.json(
        { error: `No item ${strays[0]!.placementId} on side ${strays[0]!.side}.` },
        400,
      );
    }
    const [saved] = await db!
      .insert(ratings)
      .values({
        ...input,
        note: input.note?.trim() || null,
        itemNotes: input.itemNotes.map((n) => ({ ...n, note: n.note.trim() })),
        tags: [...new Set(input.tags)],
        accountId: c.var.account.id,
      })
      .returning();
    const scores = {
      a: roomScoreOf(a.breakdown, input.roomId) ?? NO_SCORE,
      b: roomScoreOf(b.breakdown, input.roomId) ?? NO_SCORE,
    };
    const body: RatingSaved = {
      rating: Rating.parse(saved),
      scorer: { ...scores, pick: scorerPick(scores.a, scores.b) },
    };
    return c.json(body, 201);
  });

  app.post('/ratings/:id/archive', async (c) => {
    const id = c.req.param('id');
    const [row] = z.uuid().safeParse(id).success
      ? await db!.update(ratings).set({ status: 'archived' }).where(eq(ratings.id, id)).returning()
      : [];
    return row ? c.json(Rating.parse(row)) : c.json({ error: 'No such rating.' }, 404);
  });

  /** A rating, and what its notes are about: the room in each of its two layouts. */
  async function rated(id: string) {
    if (!z.uuid().safeParse(id).success) return undefined;
    const [row] = await db!.select().from(ratings).where(eq(ratings.id, id));
    if (!row) return undefined;
    const rating = Rating.parse(row);
    const rows = await db!
      .select({ id: layouts.id, floorplanId: layouts.floorplanId, placements: layouts.placements })
      .from(layouts)
      .where(inArray(layouts.id, [rating.layoutA, rating.layoutB]));
    const side = (id: string) =>
      Placements.parse(rows.find((r) => r.id === id)?.placements ?? []).filter(
        (p) => p.roomId === rating.roomId,
      );
    const [plan] = await db!
      .select()
      .from(floorplans)
      .where(eq(floorplans.id, rows[0]?.floorplanId ?? rating.layoutA));
    if (!plan) return undefined;
    return {
      rating,
      plan: Floorplan.parse(plan),
      sides: { a: side(rating.layoutA), b: side(rating.layoutB) },
    };
  }

  app.post('/ratings/:id/read', async (c) => {
    if (!noteReader) {
      return c.json({ error: 'No note reader is set up: add CLAUDE_API_KEY to .env.' }, 503);
    }
    const found = await rated(c.req.param('id'));
    if (!found) return c.json({ error: 'No such rating.' }, 404);
    const { rating, plan, sides } = found;
    if (!hasNotes(rating)) return c.json({ error: 'The rating has nothing written to read.' }, 400);
    const { account } = c.var;
    const refused = await allowance?.take(account, 'read_note', noteReader.model);
    if (refused) return c.json(refused.refusal, refused.status);
    const articleNos = [...new Set([...sides.a, ...sides.b].map((p) => p.articleNo))];
    const known = await db!.select().from(products).where(inArray(products.articleNo, articleNos));
    const request: NoteRequest = {
      plan,
      roomId: rating.roomId,
      sides,
      products: new Map(
        Product.array()
          .parse(known)
          .map((p) => [p.articleNo, p]),
      ),
      rating,
    };
    const log = (spent: Parameters<typeof recordUsage>[4]) =>
      recordUsage(db!, account, 'read_note', plan.id, spent);
    let result;
    try {
      result = await noteReader.read(request, c.req.raw.signal);
    } catch (e) {
      // A reading that failed still cost what it used.
      const usage = (e instanceof ReaderError && e.usage) || { inputTokens: 0, outputTokens: 0 };
      await log({ model: noteReader.model, usage, failed: true });
      if (e instanceof ReaderError) return c.json({ error: e.message }, e.status);
      throw e;
    } finally {
      allowance?.release(account);
    }
    await log({ model: result.model, usage: result.usage });
    const labels: NoteReading = {
      labels: result.labels,
      model: result.model,
      promptVersion: noteReader.promptVersion,
      corrected: false,
    };
    const [row] = await db!
      .update(ratings)
      .set({ labels })
      .where(eq(ratings.id, rating.id))
      .returning();
    return c.json(Rating.parse(row));
  });

  app.put('/ratings/:id/labels', async (c) => {
    const found = await rated(c.req.param('id'));
    if (!found) return c.json({ error: 'No such rating.' }, 404);
    const body = z
      .object({ labels: z.array(NoteLabel) })
      .safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400);
    const { rating, plan, sides } = found;
    const request = { plan, roomId: rating.roomId, sides, products: new Map(), rating };
    const problems = labelProblems(body.data.labels, request);
    if (problems.length > 0) return c.json({ error: problems.join(' ') }, 400);
    // The reading they corrected, or labels written by hand when there was none.
    const labels: NoteReading = {
      labels: body.data.labels,
      model: rating.labels?.model ?? 'rater',
      promptVersion: rating.labels?.promptVersion ?? 'by-hand',
      corrected: true,
    };
    const [row] = await db!
      .update(ratings)
      .set({ labels })
      .where(eq(ratings.id, rating.id))
      .returning();
    return c.json(Rating.parse(row));
  });

  app.get('/ratings/summary', async (c) => {
    const [versions, rated] = await Promise.all([pool(), active()]);
    const byKey = new Map(versions.map((v) => [`${v.layoutId}|${v.roomId}`, v]));
    const decided = rated.filter((r) => r.winner !== 'same');
    const agrees = decided.filter((r) => {
      const [a, b] = [r.layoutA, r.layoutB].map((id) => byKey.get(`${id}|${r.roomId}`));
      return a && b && scorerPick(a, b) === r.winner;
    });
    const roomOf = (v: Version | undefined) => v && `${v.floorplanId}|${v.roomId}`;
    const summary: RatingSummary = {
      rated: rated.length,
      decided: decided.length,
      scorerAgrees: agrees.length,
      leftWins: decided.filter((r) => r.winner === 'a').length,
      rooms: new Set(versions.map(roomOf)).size,
      roomsRated: new Set(rated.flatMap((r) => roomOf(byKey.get(`${r.layoutA}|${r.roomId}`)) ?? []))
        .size,
    };
    return c.json(summary);
  });

  return app;
}
