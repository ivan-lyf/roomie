import { validateLayout } from '@roomie/geometry';
import { Floorplan, LayoutIntent, Product } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import intentJson from '../../../../fixtures/plans/00-demo-1br/intent.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { generateHome, rearrangeIntent, rearrangeRoom } from './generate';
import { intentMessage, type IntentRequest, type IntentResult, type IntentWriter } from './intent';

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
  const requests: IntentRequest[] = [];
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
    write: async (request) => {
      requests.push(request);
      return answer(intents.shift()!);
    },
    repair: async (_, __, text) => {
      feedback.push(text);
      return answer(intents.shift()!);
    },
  };
  return { writer, feedback, requests };
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

describe('one room again', () => {
  // The demo home furnished whole, as the pipeline leaves it.
  const furnished = async () => {
    const { writer } = fakeWriter(intent);
    const home = await generateHome(plan, inputs, { writer, catalog: products, seeds: 2 });
    return { ...plan, furniture: home.winner.placements };
  };
  const bedroom = intent.rooms.find((r) => r.roomId === 'r1')!;
  const living = intent.rooms.find((r) => r.roomId === 'r2')!;

  it('gets new pieces for one room around the rest, which stays as it is', async () => {
    const home = await furnished();
    const keep = home.furniture.filter((f) => f.roomId === 'r2');
    const { writer, requests } = fakeWriter({
      rooms: [{ ...bedroom, items: bedroom.items.slice(0, 1), relations: [] }],
      budget: [{ roomId: 'r1', cad: 600 }],
      notes: '',
    });
    const again = await generateHome(
      home,
      { ...inputs, roomIds: ['r1'], budgetCad: 600 },
      { writer, catalog: products, seeds: 2, keep },
    );
    expect(again.mode).toBe('new_pieces');
    expect(again.promptVersion).toBe('layout-intent.v1+layout-room.v1');
    const message = intentMessage(requests[0]!);
    expect(message).toContain('# Kept as they are');
    expect(message).toContain('- Living (r2): TEST Three-seat sofa');
    expect(message).toMatch(/# In the room now\n\n- Bedroom \(r1\): TEST/);

    const placed = again.winner.placements;
    expect(placed.filter((f) => f.roomId === 'r2')).toEqual(keep);
    const fresh = placed.filter((f) => f.roomId === 'r1');
    expect(fresh.map((f) => [f.id, f.ref])).toEqual([[`f${home.furniture.length + 1}`, 'bed']]);
    expect(new Set(placed.map((f) => f.id)).size).toBe(placed.length);
    expect(validateLayout(home, placed, byArticle)).toEqual([]);
    for (const c of again.candidates) expect(c.placements.slice(0, keep.length)).toEqual(keep);
  });

  it("isn't failed by a problem left in a room kept", async () => {
    const home = await furnished();
    const keep = home.furniture.filter((f) => f.roomId === 'r2');
    // Two of the living room's items left standing on each other.
    const [a, b] = keep;
    const crowded = [{ ...a!, x: b!.x, y: b!.y }, ...keep.slice(1)];
    const { writer } = fakeWriter({ rooms: [bedroom], budget: [], notes: '' });
    const again = await generateHome(
      { ...home, furniture: [...crowded, ...home.furniture.filter((f) => f.roomId === 'r1')] },
      { ...inputs, roomIds: ['r1'] },
      { writer, catalog: products, seeds: 2, keep: crowded },
    );
    const problems = validateLayout(plan, again.winner.placements, byArticle);
    expect(problems.length).toBeGreaterThan(0);
    const kept = new Set(crowded.map((f) => f.id));
    for (const p of problems)
      expect(p.ids.filter((id) => id.startsWith('f')).every((id) => kept.has(id))).toBe(true);
  });

  it('rearranges a room without the LLM, its items keeping their ids and refs', async () => {
    const home = await furnished();
    const keep = home.furniture.filter((f) => f.roomId === 'r1');
    const now = home.furniture.filter((f) => f.roomId === 'r2');
    const again = await rearrangeRoom(
      home,
      { ...inputs, roomIds: ['r2'] },
      { catalog: products, keep, seeds: 3, firstSeed: 1000, intent: living },
    );
    expect(again).toMatchObject({ mode: 'rearrange', model: null, repairs: 0 });
    expect(again.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(again.seeds).toEqual([1000, 1001, 1002]);
    const placed = again.winner.placements;
    expect(placed.filter((f) => f.roomId === 'r1')).toEqual(keep);
    const after = placed.filter((f) => f.roomId === 'r2');
    const strip = (fs: typeof now) =>
      fs
        .map(({ id, ref, articleNo }) => ({ id, ref, articleNo }))
        .sort((x, y) => x.id.localeCompare(y.id));
    expect(strip(after)).toEqual(strip(now));
    const moved = after.some((f) => {
      const was = now.find((n) => n.id === f.id)!;
      return Math.hypot(f.x - was.x, f.y - was.y) > 0.1 || f.rotation !== was.rotation;
    });
    expect(moved).toBe(true);
    expect(validateLayout(plan, placed, byArticle)).toEqual([]);
  });

  it("won't rearrange a room by leaving anything out", async () => {
    const home = await furnished();
    // Three queen beds in the bedroom, where two fit at most.
    const bed = { id: 'f90', articleNo: '900.000.10', roomId: 'r1', x: 1, y: 1, rotation: 0 };
    const crowded = { ...home, furniture: ['f90', 'f91', 'f92'].map((id) => ({ ...bed, id })) };
    await expect(
      rearrangeRoom(
        crowded,
        { ...inputs, roomIds: ['r1'] },
        { catalog: products, keep: [], seeds: 2, firstSeed: 1 },
      ),
    ).rejects.toThrow("There's no other way to fit everything in the Bedroom.");
  });

  it('rearranges items without refs under those of the same products, or made-up ones', () => {
    const sofa = { id: 'f7', articleNo: '900.000.15', roomId: 'r2', x: 1, y: 1, rotation: 0 };
    const tv = { ...sofa, id: 'f8', articleNo: '900.000.18', ref: 'tv' };
    const chair = { ...sofa, id: 'f9', articleNo: '900.000.11' };
    const { intent: room, byRef, madeUp } = rearrangeIntent('r2', [sofa, tv, chair], living);
    // The sofa is the product the intent chose as `sofa`; nothing like the third was chosen.
    expect(room.items.map((i) => i.ref)).toEqual(['sofa', 'tv', 'item_f9']);
    expect([...madeUp]).toEqual(['item_f9']);
    expect(room.items[1]!.why).toBe(living.items.find((i) => i.ref === 'tv')!.why);
    expect(byRef.get('sofa')).toBe(sofa);
    // Relations hold between the items there, and only those.
    const facing = room.relations.find((r) => r.kind === 'facing' && r.item === 'sofa');
    expect(facing).toBeDefined();
    for (const r of room.relations) expect(JSON.stringify(r)).not.toMatch(/"(coffee|armchair)"/);
  });
});
