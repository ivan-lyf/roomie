import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Floorplan,
  type GenerationJob,
  HomeFurnishing,
  Layout,
  LayoutIntent,
  type LoggedIntent,
  Product,
} from '@roomie/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import intentJson from '../../../../fixtures/plans/00-demo-1br/intent.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { createApp } from '../app';
import { layouts, products } from '../db/schema';
import { testDb } from '../test/db';
import { pngHeader } from '../test/fixtures';
import type { IntentWriter } from './intent';

let dataDir: string;
let db: Awaited<ReturnType<typeof testDb>>;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'roomie-layouts-'));
  db = await testDb();
  await db.insert(products).values(Product.array().parse(catalog));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const writer: IntentWriter = {
  model: 'claude-opus-5-5',
  promptVersion: 'layout-intent.v1',
  write: async () => ({
    intent: LayoutIntent.parse(intentJson),
    problems: [],
    model: 'claude-opus-5-5',
    usage: { inputTokens: 10_000, outputTokens: 4000 },
    durationMs: 1,
    messages: [],
  }),
  repair: async () => {
    throw new Error('no repairs expected');
  },
};

const app = (layoutWriter?: IntentWriter) =>
  createApp({ dataDir, db, ...(layoutWriter && { layoutWriter }), layoutSeeds: 2 });

/** The demo home, saved as a new plan. */
async function savedDemo(): Promise<Floorplan> {
  const form = new FormData();
  form.set(
    'image',
    new File([new Uint8Array(pngHeader(1200, 900))], 'demo.png', { type: 'image/png' }),
  );
  const created = Floorplan.parse(
    await (await app().request('/api/floorplans', { method: 'POST', body: form })).json(),
  );
  await app().request(`/api/floorplans/${created.id}`, {
    method: 'PUT',
    body: JSON.stringify(Floorplan.parse(demo)),
  });
  return created;
}

const inputs = {
  roomIds: ['r1', 'r2'],
  budgetCad: 3000,
  style: 'scandinavian' as const,
  mustHaves: {},
};

describe('POST /api/floorplans/:id/layouts', () => {
  it('furnishes the home, logs every candidate, and makes the winner its furniture', async () => {
    const plan = await savedDemo();
    const served = app(writer);
    const res = await served.request(`/api/floorplans/${plan.id}/layouts`, {
      method: 'POST',
      body: JSON.stringify(inputs),
    });
    expect(res.status).toBe(202);
    const { generationId } = (await res.json()) as { generationId: string };

    let job: GenerationJob | undefined;
    for (let i = 0; i < 100 && job?.status !== 'done' && job?.status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      // The same app: generations live in its memory.
      job = (await (
        await served.request(`/api/generations/${generationId}`)
      ).json()) as GenerationJob;
    }
    expect(job).toMatchObject({ status: 'done', rooms: [{ status: 'done' }, { status: 'done' }] });
    // $4 and $20 per million tokens in and out.
    expect(job!.costUsd).toBeCloseTo(0.04 + 0.08);

    const rows = Layout.array().parse(await db.select().from(layouts));
    expect(rows.map((r) => r.status).sort()).toEqual(['candidate', 'candidate', 'winner']);
    const winner = rows.find((r) => r.status === 'winner')!;
    expect(winner).toMatchObject({ generationId, promptVersion: 'layout-intent.v1' });
    const saved = Floorplan.parse(await (await app().request(`/api/floorplans/${plan.id}`)).json());
    expect(saved.furniture).toEqual(winner.placements);
    expect(saved.furnishedFrom).toBe(winner.id);
    expect(job!.furniture).toEqual(winner.placements);
  });

  it('says why it can’t furnish: no writer, no plan, or rooms with no furniture', async () => {
    const plan = await savedDemo();
    const post = (a: ReturnType<typeof app>, id: string, body: object) =>
      a.request(`/api/floorplans/${id}/layouts`, { method: 'POST', body: JSON.stringify(body) });
    expect((await post(app(), plan.id, inputs)).status).toBe(503);
    expect((await post(app(writer), '00000000-0000-4000-8000-000000000000', inputs)).status).toBe(
      404,
    );
    const kitchen = await post(app(writer), plan.id, { ...inputs, roomIds: ['r3'] });
    expect(kitchen.status).toBe(400);
    expect(await kitchen.json()).toEqual({ error: "Room r3 isn't one that gets furniture." });
  });
});

describe('GET /api/floorplans/:id/furnishing', () => {
  const intent = LayoutIntent.parse(intentJson);
  const logged = (i: LayoutIntent, mode: LoggedIntent['mode']): LoggedIntent => ({
    intent: i,
    mode,
    model: 'claude-test',
    usage: { inputTokens: 0, outputTokens: 0 },
    repairs: 0,
  });
  type Fields = Pick<typeof layouts.$inferInsert, 'inputs' | 'llmIntent' | 'status'>;
  const row = (floorplanId: string, at: string, fields: Fields) => ({
    floorplanId,
    generationId: randomUUID(),
    placements: [],
    score: 0.8,
    scoreBreakdown: {},
    promptVersion: 'layout-intent.v1',
    createdAt: new Date(at),
    ...fields,
  });

  it("gives each room the intent it was last furnished from, and the home's budget", async () => {
    const plan = await savedDemo();
    // The bedroom planned again, with only its bed this time.
    const bedroom = { ...intent.rooms.find((r) => r.roomId === 'r1')!, relations: [] };
    bedroom.items = bedroom.items.slice(0, 1);
    const again = { rooms: [bedroom], budget: [{ roomId: 'r1', cad: 900 }], notes: '' };
    const [home, room] = await db
      .insert(layouts)
      .values([
        row(plan.id, '2026-10-28T10:00:00Z', {
          inputs,
          llmIntent: logged(intent, 'home'),
          status: 'winner',
        }),
        row(plan.id, '2026-10-29T10:00:00Z', {
          inputs: { ...inputs, roomIds: ['r1'], budgetCad: 900 },
          llmIntent: logged(again, 'new_pieces'),
          status: 'winner',
        }),
        // Candidates that didn't win, and a layout logged before modes, newest of all.
        row(plan.id, '2026-10-29T11:00:00Z', {
          inputs: { ...inputs, roomIds: ['r2'] },
          llmIntent: { ...logged(again, 'home'), mode: undefined },
          status: 'candidate',
        }),
      ])
      .returning();

    const res = await app().request(`/api/floorplans/${plan.id}/furnishing`);
    expect(res.status).toBe(200);
    const furnishing = HomeFurnishing.parse(await res.json());
    expect(furnishing.budgetCad).toBe(3000);
    expect(furnishing.style).toBe('scandinavian');
    const byRoom = new Map(furnishing.rooms.map((r) => [r.roomId, r]));
    expect(byRoom.get('r1')).toEqual({
      roomId: 'r1',
      layoutId: room!.id,
      intent: bedroom,
      budgetCad: 900,
    });
    expect(byRoom.get('r2')).toMatchObject({
      layoutId: home!.id,
      intent: intent.rooms.find((r) => r.roomId === 'r2'),
      budgetCad: intent.budget.find((b) => b.roomId === 'r2')!.cad,
    });
  });

  it('is empty for a home furnished by hand, and 404 for no plan', async () => {
    const plan = await savedDemo();
    const res = await app().request(`/api/floorplans/${plan.id}/furnishing`);
    expect(await res.json()).toEqual({ budgetCad: null, style: null, rooms: [] });
    const none = await app().request(
      '/api/floorplans/00000000-0000-4000-8000-000000000000/furnishing',
    );
    expect(none.status).toBe(404);
  });
});
