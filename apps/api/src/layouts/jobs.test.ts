import { randomUUID } from 'node:crypto';
import { Floorplan } from '@roomie/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { floorplans } from '../db/schema';
import { testDb } from '../test/db';
import { createJob, fail, finish, progress, readJob, runningFor, STALE_MS } from './jobs';

let db: Awaited<ReturnType<typeof testDb>>;
let floorplanId: string;
const accountId = '00000000-0000-4000-8000-0000000000a1';

beforeEach(async () => {
  db = await testDb();
  floorplanId = randomUUID();
  await db.insert(floorplans).values({ ...Floorplan.parse(demo), id: floorplanId });
});

const start = async (route: 'furnish_home' | 'rearrange' = 'furnish_home') => {
  const id = randomUUID();
  await createJob(db, {
    id,
    floorplanId,
    accountId: route === 'rearrange' ? null : accountId,
    route,
    roomId: null,
    roomIds: ['r1', 'r2'],
  });
  return id;
};

describe('furnishing jobs', () => {
  it('start running, with every room waiting, and holding the home and the account', async () => {
    const id = await start();
    expect(await readJob(db, id)).toEqual({
      generationId: id,
      floorplanId,
      status: 'running',
      rooms: [
        { roomId: 'r1', status: 'waiting' },
        { roomId: 'r2', status: 'waiting' },
      ],
    });
    expect(await runningFor(db, { floorplanId })).toBe(true);
    expect(await runningFor(db, { accountId })).toBe(true);
  });

  it('say how each room went, and what the furnishing came to', async () => {
    const id = await start();
    await progress(db, id, [
      { roomId: 'r1', status: 'done' },
      { roomId: 'r2', status: 'failed', reasons: ['It wasn’t furnished.'] },
    ]);
    const layoutId = randomUUID();
    const sofa = { id: 'f1', articleNo: '123.456.78', roomId: 'r1', x: 1, y: 2, rotation: 0 };
    await finish(db, id, { layoutId, furniture: [sofa], costUsd: 0.12 });
    expect(await readJob(db, id)).toMatchObject({
      status: 'done',
      layoutId,
      furniture: [sofa],
      costUsd: 0.12,
      rooms: [{ status: 'done' }, { status: 'failed', reasons: ['It wasn’t furnished.'] }],
    });
    expect(await runningFor(db, { floorplanId })).toBe(false);
  });

  it('say why one failed', async () => {
    const id = await start();
    await fail(db, id, 'The intent was invalid.');
    expect(await readJob(db, id)).toMatchObject({ status: 'failed', error: 'The intent was invalid.' });
  });

  it('read as failed once dead, and stop holding the home', async () => {
    const id = await start();
    const later = new Date(Date.now() + STALE_MS + 1000);
    expect(await runningFor(db, { floorplanId }, later)).toBe(false);
    expect(await readJob(db, id, later)).toMatchObject({ status: 'failed', error: /too long/ });
    // Marked failed for good, not only as read then.
    expect(await readJob(db, id)).toMatchObject({ status: 'failed' });
  });

  it("hold no account for a rearrange, and know nothing of ids they don't have", async () => {
    await start('rearrange');
    expect(await runningFor(db, { accountId })).toBe(false);
    expect(await readJob(db, randomUUID())).toBeUndefined();
    expect(await readJob(db, 'nonsense')).toBeUndefined();
  });
});
