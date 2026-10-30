import { randomUUID } from 'node:crypto';
import {
  Floorplan,
  LayoutIntent,
  NextPair,
  Product,
  Rating,
  type RatingInput,
  RatingSaved,
  RatingSummary,
} from '@roomie/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import intentJson from '../../../../fixtures/plans/00-demo-1br/intent.json';
import { type AppOptions, createApp } from '../app';
import { products } from '../db/schema';
import { generateHome } from '../layouts/generate';
import type { IntentWriter } from '../layouts/intent';
import { logGeneration } from '../layouts/log';
import { testInputs } from '../layouts/test-homes';
import { testDb } from '../test/db';
import { testHomePlan } from './pool';

let db: Awaited<ReturnType<typeof testDb>>;
const items = Product.array().parse(catalog);

const answer = {
  intent: LayoutIntent.parse(intentJson),
  problems: [],
  model: 'claude-haiku-5-5',
  usage: { inputTokens: 0, outputTokens: 0 },
  durationMs: 1,
  messages: [],
};
const writer: IntentWriter = {
  model: 'claude-haiku-5-5',
  promptVersion: 'layout-intent.v1',
  write: async () => answer,
  repair: async () => answer,
};

/** The demo home in the pool, furnished once with three seeds. */
beforeEach(async () => {
  db = await testDb();
  await db.insert(products).values(items);
  const { plan } = (await testHomePlan(db, { name: '00-demo-1br', plan: Floorplan.parse(demo) }))!;
  const inputs = testInputs(plan);
  const home = await generateHome(plan, inputs, { writer, catalog: items, seeds: 3 });
  await logGeneration(db, plan.id, randomUUID(), inputs, home);
});

// Sign-in is off: everyone is an admin. Sign-in itself is tested further down.
const app = (options: Partial<AppOptions> = {}) =>
  createApp({ dataDir: '/nowhere', db, auth: { kind: 'off' }, ...options });

async function next(served = app()) {
  return NextPair.parse(await (await served.request('/api/admin/ratings/next')).json()).pair;
}

async function rate(input: RatingInput, served = app()) {
  return served.request('/api/admin/ratings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

const blank = { livable: true, note: null, itemNotes: [], tags: [], source: 'pair', seconds: 12 };

describe('the rating routes', () => {
  it('serve one room from two layouts of a test home', async () => {
    const pair = (await next())!;
    expect(pair.plan.source).toBe('test_set');
    expect(pair.a.layoutId).not.toBe(pair.b.layoutId);
    for (const side of [pair.a, pair.b]) {
      expect(side.placements.length).toBeGreaterThan(0);
      expect(side.placements.every((p) => p.roomId === pair.roomId)).toBe(true);
    }
  });

  it('save a rating with what the scorer would have picked, and never serve that pair again', async () => {
    const seen = new Set<string>();
    let count = 0;
    for (let pair = await next(); pair; pair = await next()) {
      const key = [pair.roomId, ...[pair.a.layoutId, pair.b.layoutId].toSorted()].join();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      const res = await rate({
        ...blank,
        layoutA: pair.a.layoutId,
        layoutB: pair.b.layoutId,
        roomId: pair.roomId,
        winner: count % 3 === 0 ? 'same' : 'a',
        note: count === 0 ? '  The sofa is too far from the TV.  ' : null,
        itemNotes: [{ side: 'b', placementId: pair.b.placements[0]!.id, note: ' too close ' }],
        tags: ['too_full', 'too_full'],
      } as RatingInput);
      expect(res.status).toBe(201);
      const saved = RatingSaved.parse(await res.json());
      if (count === 0) expect(saved.rating.note).toBe('The sofa is too far from the TV.');
      expect(saved.rating.itemNotes[0]!.note).toBe('too close');
      expect(saved.rating.tags).toEqual(['too_full']);
      expect(saved.rating.accountId).toBe('00000000-0000-0000-0000-000000000000');
      expect(['a', 'b', 'same']).toContain(saved.scorer.pick);
      expect(saved.scorer.a.score).toBeGreaterThan(0);
      count++;
      if (count > 50) throw new Error('pairs keep coming');
    }
    // Two rooms, at most four distinct layouts of each: at most six pairs a room.
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(12);
    const summary = RatingSummary.parse(
      await (await app().request('/api/admin/ratings/summary')).json(),
    );
    expect(summary).toMatchObject({ rated: count, rooms: 2, roomsRated: 2 });
    expect(summary.decided).toBe(count - Math.ceil(count / 3));
    expect(summary.leftWins).toBe(summary.decided);
    expect(summary.scorerAgrees).toBeLessThanOrEqual(summary.decided);
  });

  it('take a rating back without deleting it', async () => {
    const pair = (await next())!;
    const input = {
      ...blank,
      layoutA: pair.a.layoutId,
      layoutB: pair.b.layoutId,
      roomId: pair.roomId,
      winner: 'b',
    } as RatingInput;
    const { rating } = RatingSaved.parse(await (await rate(input)).json());
    const res = await app().request(`/api/admin/ratings/${rating.id}/archive`, { method: 'POST' });
    expect(Rating.parse(await res.json()).status).toBe('archived');
    const summary = RatingSummary.parse(
      await (await app().request('/api/admin/ratings/summary')).json(),
    );
    expect(summary.rated).toBe(0);
    expect(
      (await app().request(`/api/admin/ratings/${randomUUID()}/archive`, { method: 'POST' }))
        .status,
    ).toBe(404);
  });

  it('refuse ratings that make no sense', async () => {
    const pair = (await next())!;
    const good = {
      ...blank,
      layoutA: pair.a.layoutId,
      layoutB: pair.b.layoutId,
      roomId: pair.roomId,
      winner: 'a',
    } as RatingInput;
    expect((await rate({ ...good, layoutB: good.layoutA })).status).toBe(400);
    expect((await rate({ ...good, layoutB: randomUUID() })).status).toBe(404);
    // A layout of another home with a room of the same id.
    const other = await testHomePlan(db, { name: 'copy', plan: Floorplan.parse(demo) });
    const inputs = testInputs(other!.plan);
    const home = await generateHome(other!.plan, inputs, { writer, catalog: items, seeds: 1 });
    const elsewhere = await logGeneration(db, other!.plan.id, randomUUID(), inputs, home);
    expect((await rate({ ...good, layoutB: elsewhere })).status).toBe(400);
    expect((await rate({ ...good, roomId: 'nowhere' })).status).toBe(400);
    const stray = { side: 'a' as const, placementId: 'f999', note: 'odd' };
    expect((await rate({ ...good, itemNotes: [stray] })).status).toBe(400);
    expect((await rate({ ...good, winner: 'neither' } as unknown as RatingInput)).status).toBe(400);
  });

  it('are for admins only', async () => {
    const me = { id: '11111111-2222-4333-8444-555555555555', email: 'ivan@example.com' };
    const auth = {
      kind: 'verify' as const,
      verify: async (token: string) => (token === 'good' ? me : undefined),
    };
    const call = (admins: string[], token?: string) =>
      app({ auth, admins }).request('/api/admin/ratings/next', {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    expect((await call(['ivan@example.com'])).status).toBe(401);
    expect((await call(['someone@example.com'], 'good')).status).toBe(403);
    expect((await call(['ivan@example.com'], 'good')).status).toBe(200);
  });
});
