import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Floorplan, type RawPlan, Usage } from '@roomie/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppOptions } from '../app';
import { usage } from '../db/schema';
import { type PlanImage, type PlanReader, ReaderError } from '../plan-reader/reader';
import { testDb } from '../test/db';
import { demoRawPlan, pngHeader } from '../test/fixtures';

let dataDir: string;
let db: Awaited<ReturnType<typeof testDb>>;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'roomie-read-'));
  db = await testDb();
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** A reader that returns `plan` (or throws `error`) and keeps the images it was sent. */
function fakeReader(plan: RawPlan | ReaderError = demoRawPlan()) {
  const images: PlanImage[] = [];
  const reader: PlanReader = {
    provider: 'fake',
    model: 'fake-1',
    promptVersion: 'plan-read.v1',
    planFromRaw: () => demoRawPlan(),
    async read(image) {
      images.push(image);
      if (plan instanceof ReaderError) throw plan;
      return {
        raw: { answer: true },
        plan,
        usage: { inputTokens: 10, outputTokens: 5 },
        durationMs: 42,
      };
    },
  };
  return { reader, images };
}

// Sign-in is off unless a test says otherwise.
const app = (options: Partial<AppOptions> = {}) =>
  createApp({ dataDir, db, auth: { kind: 'off' }, ...options });

/** Uploads a 900 x 750 plan image (only its header: the fake reader never looks). */
async function uploaded(): Promise<Floorplan> {
  const form = new FormData();
  form.set(
    'image',
    new File([new Uint8Array(pngHeader(900, 750))], 'demo.png', { type: 'image/png' }),
  );
  const res = await app().request('/api/floorplans', { method: 'POST', body: form });
  return Floorplan.parse(await res.json());
}

const read = async (id: string, options: Partial<AppOptions>, query = '') =>
  app(options).request(`/api/floorplans/${id}/read${query}`, { method: 'POST' });

describe('POST /api/floorplans/:id/read', () => {
  it('reads the plan, finds its scale and converts it to meters', async () => {
    const plan = await uploaded();
    const { reader, images } = fakeReader();
    const res = await read(plan.id, { reader });
    expect(res.status).toBe(200);
    const result = Floorplan.parse(await res.json());
    expect(images[0]).toMatchObject({ mimeType: 'image/png', width: 900, height: 750 });
    expect(result.status).toBe('ready');
    expect(result.scale).toMatchObject({ sourceUnit: 'imperial', method: 'labels' });
    expect(result.scale!.metersPerPixel).toBeCloseTo(0.01, 3);
    expect(result.rooms.map((r) => r.roomType)).toEqual([
      'bedroom',
      'living_room',
      'kitchen',
      'bathroom',
      'closet',
      'hallway',
    ]);
    expect(result.openings).toHaveLength(10);
    expect(result.reading).toMatchObject({
      provider: 'fake',
      model: 'fake-1',
      promptVersion: 'plan-read.v1',
      durationMs: 42,
      usage: { inputTokens: 10, outputTokens: 5 },
      raw: { answer: true },
      scaleCandidates: [],
    });
    // Saved, not just answered.
    const saved = await app().request(`/api/floorplans/${plan.id}`);
    expect(Floorplan.parse(await saved.json()).rooms).toHaveLength(6);
  });

  it('keeps the draft for calibration when the labels give no scale', async () => {
    const plan = await uploaded();
    const unlabelled = { ...demoRawPlan(), texts: [] };
    const result = Floorplan.parse(await (await read(plan.id, fakeReader(unlabelled))).json());
    expect(result).toMatchObject({
      status: 'needs_calibration',
      scale: null,
      walls: [],
      rooms: [],
    });
    expect(result.reading!.draft.walls.length).toBeGreaterThan(0);
  });

  it('keeps what was saved while the plan was being read', async () => {
    const plan = await uploaded();
    const reader: PlanReader = {
      ...fakeReader().reader,
      async read() {
        // The user renames the plan while Gemini thinks.
        await app().request(`/api/floorplans/${plan.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...plan, name: 'Renamed meanwhile' }),
        });
        return { raw: {}, plan: demoRawPlan(), durationMs: 1 };
      },
    };
    const result = Floorplan.parse(await (await read(plan.id, { reader })).json());
    expect(result).toMatchObject({ name: 'Renamed meanwhile', status: 'ready' });
  });

  it('reads an image read before from the cache, and asks afresh to read it again', async () => {
    const [first, second] = [await uploaded(), await uploaded()];
    const { reader, images } = fakeReader();
    await read(first.id, { reader });
    const cached = Floorplan.parse(await (await read(second.id, { reader })).json());
    expect(images).toHaveLength(1);
    expect(cached.rooms).toHaveLength(6);
    expect(cached.reading).toMatchObject({ model: 'fake-1', usage: { inputTokens: 10 } });
    expect((await read(second.id, { reader }, '?replace=1')).status).toBe(200);
    expect(images).toHaveLength(2);
  });

  it('only replaces a traced plan when asked to', async () => {
    const plan = await uploaded();
    await read(plan.id, fakeReader());
    expect((await read(plan.id, fakeReader())).status).toBe(409);
    expect((await read(plan.id, fakeReader(), '?replace=1')).status).toBe(200);
  });

  it('says why a plan could not be read, and leaves it as it was', async () => {
    const plan = await uploaded();
    const busy = fakeReader(new ReaderError('Gemini is over its rate limit.', 429));
    const res = await read(plan.id, busy);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Gemini is over its rate limit.' });
    const saved = Floorplan.parse(await (await app().request(`/api/floorplans/${plan.id}`)).json());
    expect(saved).toMatchObject({ status: 'uploaded', reading: null });
  });

  it('answers 503 without a reader, and 404 for a missing image', async () => {
    const plan = await uploaded();
    expect((await read(plan.id, {})).status).toBe(503);
    await rm(path.join(dataDir, 'uploads'), { recursive: true });
    expect((await read(plan.id, fakeReader())).status).toBe(404);
    await mkdir(path.join(dataDir, 'uploads', 'plans'), { recursive: true });
    await writeFile(path.join(dataDir, 'uploads', 'plans', `${plan.id}.png`), pngHeader(900, 750));
    expect((await read(plan.id, fakeReader())).status).toBe(200);
  });
});

describe('reading needs an account within its allowance', () => {
  const me = { id: '11111111-2222-4333-8444-555555555555', email: 'ivan@example.com' };
  const auth = {
    kind: 'verify' as const,
    verify: async (token: string) => (token === 'good' ? me : undefined),
  };
  const signedIn = { method: 'POST', headers: { authorization: 'Bearer good' } };
  const rows = async () => Usage.array().parse(await db.select().from(usage));

  it("reads nothing signed out, or where sign-in isn't set up", async () => {
    const plan = await uploaded();
    const { reader, images } = fakeReader();
    const out = await app({ reader, auth }).request(`/api/floorplans/${plan.id}/read`, {
      method: 'POST',
    });
    expect(out.status).toBe(401);
    expect(await out.json()).toMatchObject({ code: 'sign_in_required' });
    const unset = await createApp({ dataDir, db, reader }).request(
      `/api/floorplans/${plan.id}/read`,
      signedIn,
    );
    expect(unset.status).toBe(503);
    expect(await unset.json()).toMatchObject({ code: 'auth_unavailable' });
    expect(images).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it('logs each reading against the account: a cached one at nothing, a failed one too', async () => {
    const [first, second, third] = [await uploaded(), await uploaded(), await uploaded()];
    const { reader } = fakeReader();
    const signed = app({ reader, auth });
    expect((await signed.request(`/api/floorplans/${first.id}/read`, signedIn)).status).toBe(200);
    expect((await signed.request(`/api/floorplans/${second.id}/read`, signedIn)).status).toBe(200);
    const failure = new ReaderError('Gemini gave no plan (SAFETY).', 502);
    failure.usage = { inputTokens: 7, outputTokens: 3 };
    const failing = app({ reader: fakeReader(failure).reader, auth });
    const res = await failing.request(`/api/floorplans/${third.id}/read?replace=1`, signedIn);
    expect(res.status).toBe(502);
    expect(await rows()).toMatchObject([
      { accountId: me.id, route: 'read_plan', floorplanId: first.id, model: 'fake-1' },
      { floorplanId: second.id, cached: true, model: null, inputTokens: 0, costUsd: 0 },
      { floorplanId: third.id, status: 'failed', inputTokens: 7, outputTokens: 3 },
    ]);
    // No price is known for the fake model, as for Gemini's free tier.
    expect((await rows())[0]).toMatchObject({ inputTokens: 10, outputTokens: 5, costUsd: null });
  });

  it('refuses once the allowance is spent, though a cached reading costs nothing', async () => {
    const [first, second] = [await uploaded(), await uploaded()];
    const { reader, images } = fakeReader();
    await app({ reader, auth }).request(`/api/floorplans/${first.id}/read`, signedIn);
    const spent = app({ reader, auth, allowance: { dailyUsd: 0, timeZone: 'UTC' } });
    const again = await spent.request(`/api/floorplans/${first.id}/read?replace=1`, signedIn);
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ code: 'allowance_reached' });
    expect((await spent.request(`/api/floorplans/${second.id}/read`, signedIn)).status).toBe(200);
    expect(images).toHaveLength(1);
  });
});
