import { randomUUID } from 'node:crypto';
import { ROOM_FEATURES, scoreFurniture } from '@roomie/geometry';
import { Floorplan, LayoutIntent, Product } from '@roomie/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import intentJson from '../../../../fixtures/plans/00-demo-1br/intent.json';
import { layouts, products, ratings } from '../db/schema';
import { generateHome } from '../layouts/generate';
import type { IntentWriter } from '../layouts/intent';
import { logGeneration } from '../layouts/log';
import { testInputs } from '../layouts/test-homes';
import { testDb } from '../test/db';
import { COLUMNS, exportRow, loadRated, noteLine, toCsv } from './export';
import { testHomePlan } from './pool';

let db: Awaited<ReturnType<typeof testDb>>;
const items = Product.array().parse(catalog);
const intent = LayoutIntent.parse(intentJson);
const answer = {
  intent,
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

beforeEach(async () => {
  db = await testDb();
  await db.insert(products).values(items);
});

/** The demo home in the pool, and one rating of its living room with a note read into labels. */
async function oneRating() {
  const { plan } = (await testHomePlan(db, {
    name: 'demo, the first',
    plan: Floorplan.parse(demo),
  }))!;
  const inputs = testInputs(plan);
  const home = await generateHome(plan, inputs, { writer, catalog: items, seeds: 2 });
  await logGeneration(db, plan.id, randomUUID(), inputs, home);
  const [a, b] = await db.select().from(layouts).where(eq(layouts.status, 'candidate'));
  const [rating] = await db
    .insert(ratings)
    .values({
      layoutA: a!.id,
      layoutB: b!.id,
      roomId: 'r2',
      accountId: '00000000-0000-0000-0000-000000000000',
      winner: 'b',
      livable: true,
      note: 'A\'s sofa is "too far", from the TV.',
      itemNotes: [
        { side: 'a', placementId: a!.placements.find((p) => p.roomId === 'r2')!.id, note: 'far' },
      ],
      tags: ['too_empty', 'needs_more_seating'],
      labels: {
        labels: [
          {
            side: 'a',
            items: [],
            problem: 'too_far_from',
            relativeTo: null,
            feature: 'tv_view',
            rule: null,
          },
          { side: 'a', items: [], problem: 'style', relativeTo: null, feature: null, rule: null },
        ],
        model: 'claude-haiku-5-5',
        promptVersion: 'rating-note.v1',
        corrected: false,
      },
      seconds: 21.5,
    })
    .returning();
  // One taken back: left out.
  await db.insert(ratings).values({
    layoutA: a!.id,
    layoutB: b!.id,
    roomId: 'r1',
    accountId: '00000000-0000-0000-0000-000000000000',
    winner: 'a',
    status: 'archived',
  });
  return { plan, a: a!, b: b!, rating: rating! };
}

describe('the ratings export', () => {
  it("gives each active rating both rooms' features by today's scorer", async () => {
    const { plan, a, b, rating } = await oneRating();
    const rated = await loadRated(db);
    expect(rated).toHaveLength(1);
    const row = exportRow(rated[0]!);
    expect(row).toMatchObject({
      rating_id: rating.id,
      home: 'demo, the first',
      room_id: 'r2',
      room_type: 'living_room',
      source: 'pair',
      winner: 'b',
      livable: true,
      same_pieces: true,
      seconds: 21.5,
      tags: 'too_empty|needs_more_seating',
      label_features: 'tv_view|none',
      layout_a: a.id,
      layout_b: b.id,
      mode_a: 'home',
      model_b: 'claude-haiku-5-5',
      weights_a: 'current',
      prompt_a: 'layout-intent.v1',
    });
    const room = intent.rooms.find((r) => r.roomId === 'r2')!;
    const byHand = scoreFurniture(
      plan,
      a.placements.filter((p) => p.roomId === 'r2'),
      new Map(items.map((p) => [p.articleNo, p])),
      { intents: [room] },
    ).rooms.get('r2')!;
    expect(row.score_a).toBeCloseTo(byHand.score, 9);
    for (const f of ROOM_FEATURES) expect(row[`a_${f}`]).toBe(byHand.breakdown[f] ?? null);
  });

  it('writes CSV with every column, quoting what needs it', async () => {
    await oneRating();
    const rows = (await loadRated(db)).map(exportRow);
    const csv = toCsv(rows);
    const [header, line] = csv.trimEnd().split('\n');
    expect(header).toBe(COLUMNS.join(','));
    expect(COLUMNS).toContain('b_tv_view');
    expect(line).toContain(',"demo, the first",');
    expect(toCsv([{ ...rows[0]!, home: 'say "hi"' }])).toContain(',"say ""hi""",');
  });

  it('keeps the notes as written, with what each flagged item is', async () => {
    const { rating } = await oneRating();
    const [rated] = await loadRated(db);
    const line = JSON.parse(noteLine(rated!));
    expect(line).toMatchObject({
      ratingId: rating.id,
      roomType: 'living_room',
      note: 'A\'s sofa is "too far", from the TV.',
      labels: { promptVersion: 'rating-note.v1' },
    });
    expect(line.itemNotes[0].product).toMatch(/^TEST /);
  });
});
