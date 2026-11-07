import {
  Generation,
  GenerationJob,
  type GenerationRoute,
  type Placement,
  type RoomProgress,
} from '@roomie/schema';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { generations } from '../db/schema';

// Furnishings, kept in the database (M8): on Vercel each request may reach another instance of
// the API, so a furnishing started on one is followed, and checked for, on any other.

/**
 * A furnishing untouched this long has died with its server (a function cut off at its time
 * limit): it reads as failed, and no longer holds its home or account.
 */
export const STALE_MS = 10 * 60 * 1000;

const TOO_LONG = 'It took too long; try again.';

type New = {
  id: string;
  floorplanId: string;
  accountId: string | null;
  route: GenerationRoute;
  roomId: string | null;
  roomIds: readonly string[];
};

/** Starts a furnishing's record: running, every room waiting. */
export async function createJob(db: Db, job: New): Promise<void> {
  await db.insert(generations).values({
    id: job.id,
    floorplanId: job.floorplanId,
    accountId: job.accountId,
    route: job.route,
    roomId: job.roomId,
    status: 'running',
    rooms: job.roomIds.map((roomId) => ({ roomId, status: 'waiting' as const })),
  });
}

/** How each room is going. */
export async function progress(db: Db, id: string, rooms: RoomProgress[]): Promise<void> {
  await db.update(generations).set({ rooms, updatedAt: new Date() }).where(eq(generations.id, id));
}

/** What a furnishing came to: its winning layout, now the home's furniture. */
export async function finish(
  db: Db,
  id: string,
  done: { layoutId: string; furniture: Placement[]; costUsd: number | undefined },
): Promise<void> {
  await db
    .update(generations)
    .set({
      status: 'done',
      layoutId: done.layoutId,
      furniture: done.furniture,
      costUsd: done.costUsd ?? null,
      updatedAt: new Date(),
    })
    .where(eq(generations.id, id));
}

export async function fail(db: Db, id: string, error: string): Promise<void> {
  await db
    .update(generations)
    .set({ status: 'failed', error, updatedAt: new Date() })
    .where(eq(generations.id, id));
}

/** A furnishing as the browser follows it; a dead one is marked failed as it's read. */
export async function readJob(
  db: Db,
  id: string,
  now = new Date(),
): Promise<GenerationJob | undefined> {
  if (!z.uuid().safeParse(id).success) return undefined;
  const [row] = await db.select().from(generations).where(eq(generations.id, id));
  if (!row) return undefined;
  let job = Generation.parse(row);
  if (job.status === 'running' && now.getTime() - job.updatedAt.getTime() > STALE_MS) {
    await db
      .update(generations)
      .set({ status: 'failed', error: TOO_LONG })
      .where(and(eq(generations.id, id), eq(generations.status, 'running')));
    job = { ...job, status: 'failed', error: TOO_LONG };
  }
  return GenerationJob.parse({
    generationId: job.id,
    floorplanId: job.floorplanId,
    status: job.status,
    rooms: job.rooms,
    ...(job.error !== null && { error: job.error }),
    ...(job.layoutId !== null && { layoutId: job.layoutId }),
    ...(job.furniture !== null && { furniture: job.furniture }),
    ...(job.costUsd !== null && { costUsd: job.costUsd }),
  });
}

/** Whether a home, or an account, has a furnishing under way that's still alive. */
export async function runningFor(
  db: Db,
  of: { floorplanId: string } | { accountId: string },
  now = new Date(),
): Promise<boolean> {
  const whose =
    'floorplanId' in of
      ? eq(generations.floorplanId, of.floorplanId)
      : eq(generations.accountId, of.accountId);
  const [row] = await db
    .select({ id: generations.id })
    .from(generations)
    .where(
      and(
        whose,
        eq(generations.status, 'running'),
        gt(generations.updatedAt, new Date(now.getTime() - STALE_MS)),
      ),
    )
    .limit(1);
  return row !== undefined;
}
