import { validateLayout } from '@roomie/geometry';
import { Floorplan, LayoutIntent, Product } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import intentJson from '../../../../fixtures/plans/00-demo-1br/intent.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { generateHome } from './generate';
import type { IntentResult, IntentWriter } from './intent';

const plan = Floorplan.parse(demo);
const products = Product.array().parse(catalog);
const byArticle = new Map(products.map((p) => [p.articleNo, p]));
const intent = LayoutIntent.parse(intentJson);
const inputs = {
  roomIds: ['r1', 'r2'],
  budgetCad: 3000,
  style: 'scandinavian' as const,
  mustHaves: {},
};

/** A writer answering each call with the next intent, keeping the feedback it got. */
function fakeWriter(...intents: LayoutIntent[]) {
  const feedback: string[] = [];
  const answer = (i: LayoutIntent): IntentResult => ({
    intent: i,
    problems: [],
    model: 'claude-test',
    usage: { inputTokens: 1000, outputTokens: 500 },
    durationMs: 1,
    messages: [],
  });
  const writer: IntentWriter = {
    model: 'claude-test',
    promptVersion: 'layout-intent.v1',
    write: async () => answer(intents.shift()!),
    repair: async (_, __, text) => {
      feedback.push(text);
      return answer(intents.shift()!);
    },
  };
  return { writer, feedback };
}

describe('generateHome', () => {
  it('furnishes every room from the intent, valid, with a candidate per seed', async () => {
    const { writer, feedback } = fakeWriter(intent);
    const progress: string[] = [];
    const home = await generateHome(plan, inputs, {
      writer,
      catalog: products,
      seeds: 3,
      onProgress: (rooms) => progress.push(rooms.map((r) => r.status).join(',')),
    });
    expect(feedback).toEqual([]);
    expect(home.candidates).toHaveLength(3);
    expect(home.rooms).toEqual([
      { roomId: 'r1', status: 'done' },
      { roomId: 'r2', status: 'done' },
    ]);
    expect(progress).toEqual(['waiting,waiting', 'done,done']);
    expect(home.winner.placements.map((p) => p.id)).toEqual(
      home.winner.placements.map((_, i) => `f${i + 1}`),
    );
    expect(home.winner.placements).toHaveLength(11);
    // Each item keeps the intent's name for it, to find its reason and relations later.
    const refs = intent.rooms.flatMap((r) => r.items.map((i) => i.ref));
    expect(home.winner.placements.map((p) => p.ref).toSorted()).toEqual(refs.toSorted());
    expect(validateLayout(plan, home.winner.placements, byArticle)).toEqual([]);
    expect(home.winner.score).toBeGreaterThan(0.6);
    expect(home.winner.breakdown).toHaveProperty('r1.relations');
    expect(home.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
  });

  it('sends rooms that failed back for repair, then ships what fits and says why', async () => {
    const crowded: LayoutIntent = {
      ...intent,
      rooms: [
        {
          roomId: 'r1',
          items: ['a', 'b', 'c'].map((ref) => ({ ref, articleNo: '900.000.10', why: '' })),
          relations: [],
        },
        intent.rooms[1]!,
      ],
    };
    const { writer, feedback } = fakeWriter(crowded, crowded, crowded);
    const home = await generateHome(plan, inputs, { writer, catalog: products, seeds: 2 });
    expect(home.repairs).toBe(2);
    expect(feedback[0]).toMatch(/In Bedroom \(r1\), c: The 1.60 × 2.10 m bed has no spot left/);
    expect(home.rooms[0]).toMatchObject({ roomId: 'r1', status: 'done' });
    expect(home.rooms[0]!.reasons!.length).toBeGreaterThan(0);
    expect(validateLayout(plan, home.winner.placements, byArticle)).toEqual([]);
  });

  it('leaves out the least needed items to stay within budget', async () => {
    const { writer } = fakeWriter(intent, intent, intent);
    // Everything costs $2,599: the lamp ($59) goes first, then a rug ($129).
    const home = await generateHome(
      plan,
      { ...inputs, budgetCad: 2500 },
      { writer, catalog: products, seeds: 1 },
    );
    const total = home.winner.placements.reduce(
      (s, p) => s + byArticle.get(p.articleNo)!.priceCad,
      0,
    );
    expect(total).toBeLessThanOrEqual(2500);
    expect(home.rooms.flatMap((r) => r.reasons ?? [])).toEqual([
      'The TEST Rug was left out to stay within budget.',
      'The TEST Floor lamp was left out to stay within budget.',
    ]);
  });

  it('lets the server answer other requests while it solves', async () => {
    const { writer } = fakeWriter(intent);
    let [turns, done] = [0, false];
    const other = () => {
      if (done) return;
      turns++;
      setImmediate(other);
    };
    setImmediate(other);
    await generateHome(plan, inputs, { writer, catalog: products, seeds: 3 });
    done = true;
    // Two rooms, three tries each: a turn before every try.
    expect(turns).toBeGreaterThanOrEqual(6);
  });
});
