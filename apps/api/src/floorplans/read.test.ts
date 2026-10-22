import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Floorplan, type RawPlan } from '@roomie/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppOptions } from '../app';
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

const app = (options: Partial<AppOptions> = {}) => createApp({ dataDir, db, ...options });

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
