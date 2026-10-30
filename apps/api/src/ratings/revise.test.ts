import type Anthropic from '@anthropic-ai/sdk';
import { validateLayout } from '@roomie/geometry';
import { Floorplan, LayoutIntent, Product, type RoomIntent } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import intentJson from '../../../../fixtures/plans/00-demo-1br/intent.json';
import { generateHome, reviseRoom } from '../layouts/generate';
import type { IntentWriter } from '../layouts/intent';
import { testInputs } from '../layouts/test-homes';
import { ReaderError } from '../plan-reader/reader';
import {
  claudeRoomReviser,
  type ReviseRequest,
  reviseMessage,
  revisionProblems,
  type RoomReviser,
  REVISE_ROOM_PROMPT,
} from './revise';

const plan = Floorplan.parse(demo);
const items = Product.array().parse(catalog);
const products = new Map(items.map((p) => [p.articleNo, p]));
const intent = LayoutIntent.parse(intentJson);
const bedroom = intent.rooms.find((r) => r.roomId === 'r1')!;

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

/** The demo home, furnished as a test home is: its winner, and the seeds it tried. */
async function furnished() {
  const inputs = testInputs(plan);
  const home = await generateHome(plan, inputs, { writer, catalog: items, seeds: 3 });
  return { inputs, home };
}

const request = (placements: ReviseRequest['placements']): ReviseRequest => ({
  plan,
  intent: bedroom,
  placements,
  products,
  words: 'Lose the rug, and put the wardrobe in a corner.',
});

/** The bedroom's plan without the rug, the wardrobe in a corner. */
const revision = {
  items: bedroom.items.filter((i) => i.ref !== 'rug').map(({ ref, why }) => ({ ref, why })),
  relations: [
    ...bedroom.relations.filter(
      (r) => !('item' in r && (r.item === 'rug' || r.item === 'wardrobe')),
    ),
    { kind: 'in_corner' as const, item: 'wardrobe' },
  ],
  cannot: null,
};

function message(text: string, stop: Anthropic.StopReason = 'end_turn'): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stop,
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 4000, output_tokens: 1000 },
  } as unknown as Anthropic.Message;
}

function fakeClaude(...answers: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    messages: {
      stream: (params: Anthropic.MessageCreateParamsNonStreaming) => {
        requests.push(structuredClone(params));
        const next = answers.shift()!;
        return { finalMessage: async () => next };
      },
    },
  } as unknown as NonNullable<Parameters<typeof claudeRoomReviser>[0]['client']>;
  return { client, requests };
}

const reviser = (client: ReturnType<typeof fakeClaude>['client']) =>
  claudeRoomReviser({ apiKey: 'k', model: 'claude-test', effort: 'medium', client });

describe('reviseMessage', () => {
  it('gives the room, its plan, where things stand and which way they face, and the words', async () => {
    const { home } = await furnished();
    const placed = home.winner.placements.filter((p) => p.roomId === 'r1');
    const text = reviseMessage(request(placed));
    expect(text.startsWith(REVISE_ROOM_PROMPT.text)).toBe(true);
    expect(text).toContain('Room r1: Bedroom');
    expect(text).toContain('- rug: rug,');
    expect(text).toContain(`Relations: ${JSON.stringify(bedroom.relations)}`);
    expect(text).toMatch(
      /- bed: bed, its middle [\d.]+ m east and [\d.]+ m south of the north-west corner, facing (north|south|east|west)/,
    );
    expect(text.endsWith('Lose the rug, and put the wardrobe in a corner.')).toBe(true);
  });

  it('says which way an item faces as the scorer does: turned a quarter, it faces east', () => {
    const at = (rotation: number) =>
      reviseMessage(
        request([
          {
            id: 'f1',
            ref: 'bed',
            articleNo: bedroom.items[0]!.articleNo,
            roomId: 'r1',
            x: 2,
            y: 2,
            rotation,
          },
        ]),
      );
    expect(at(0)).toMatch(/facing south/);
    expect(at(Math.PI / 2)).toMatch(/facing east/);
    expect(at(Math.PI)).toMatch(/facing north/);
  });
});

describe('revisionProblems', () => {
  it('finds items the room hasn’t got, and relations to items gone', () => {
    expect(revisionProblems(revision, bedroom)).toEqual([]);
    const added = { ...revision, items: [...revision.items, { ref: 'desk', why: '' }] };
    expect(revisionProblems(added, bedroom)).toEqual([
      "There's no desk in the room: arrange only the items listed.",
    ]);
    const dangling = {
      ...revision,
      relations: [...revision.relations, { kind: 'in_corner' as const, item: 'rug' }],
    };
    expect(revisionProblems(dangling, bedroom)).toEqual([
      "A in_corner relation names rug, which isn't one of the items that stay.",
    ]);
    expect(revisionProblems({ ...revision, items: [], relations: [] }, bedroom)).toEqual([
      'Keep at least one item.',
    ]);
  });
});

describe('claudeRoomReviser', () => {
  it('answers the revised plan, with each item’s product as it was', async () => {
    const { client, requests } = fakeClaude(message(JSON.stringify(revision)));
    const result = await reviser(client).revise(request([]));
    expect(result.intent.items.map((i) => i.ref)).toEqual([
      'bed',
      'ns_left',
      'ns_right',
      'wardrobe',
    ]);
    expect(result.intent.items[3]!.articleNo).toBe(bedroom.items[3]!.articleNo);
    expect(result.intent.relations).toContainEqual({ kind: 'in_corner', item: 'wardrobe' });
    expect(result.cannot).toBeNull();
    expect(result.usage).toEqual({ inputTokens: 4000, outputTokens: 1000 });
    expect(requests[0]!.output_config).toMatchObject({ effort: 'medium' });
  });

  it('asks again once when it arranges what the room hasn’t got, then fails cleanly', async () => {
    const added = { ...revision, items: [...revision.items, { ref: 'desk', why: '' }] };
    const once = fakeClaude(message(JSON.stringify(added)), message(JSON.stringify(revision)));
    expect((await reviser(once.client).revise(request([]))).intent.items).toHaveLength(4);
    expect(JSON.stringify(once.requests[1]!.messages.at(-1))).toContain("There's no desk");
    const twice = fakeClaude(message(JSON.stringify(added)), message('nonsense'));
    const failed = await reviser(twice.client)
      .revise(request([]))
      .catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ReaderError);
    expect((failed as ReaderError).usage).toEqual({ inputTokens: 8000, outputTokens: 2000 });
  });

  it('passes on what it couldn’t do', async () => {
    const cannot = { ...revision, cannot: 'The room has no floor lamp to sit the bed by.' };
    const { client } = fakeClaude(message(JSON.stringify(cannot)));
    expect((await reviser(client).revise(request([]))).cannot).toBe(cannot.cannot);
  });
});

describe('reviseRoom', () => {
  it('places the revised plan with the same seeds, keeping the other rooms and the items’ ids', async () => {
    const { inputs, home } = await furnished();
    const fake: RoomReviser = {
      model: 'claude-haiku-5-5',
      promptVersion: REVISE_ROOM_PROMPT.version,
      revise: async (req) => ({
        intent: {
          roomId: 'r1',
          items: req.intent.items.filter((i) => i.ref !== 'rug'),
          relations: revision.relations,
        } satisfies RoomIntent,
        cannot: null,
        model: 'claude-haiku-5-5',
        usage: { inputTokens: 4000, outputTokens: 1000 },
      }),
    };
    const layout = {
      id: '11111111-2222-4333-8444-555555555555',
      placements: home.winner.placements,
      seeds: home.seeds,
    };
    const revised = await reviseRoom(
      plan,
      { ...inputs, roomIds: ['r1'], budgetCad: 5000 },
      {
        reviser: fake,
        catalog: items,
        layout,
        intent: bedroom,
        words: 'Lose the rug.',
      },
    );
    expect(revised).toMatchObject({
      mode: 'revise',
      parent: layout.id,
      cannot: null,
      seeds: home.seeds,
    });
    expect(revised.promptVersion).toBe('revise-room.v1');
    const room = (ps: typeof layout.placements) => ps.filter((p) => p.roomId === 'r1');
    const others = (ps: typeof layout.placements) => ps.filter((p) => p.roomId !== 'r1');
    expect(others(revised.winner.placements)).toEqual(others(layout.placements));
    const before = new Map(room(layout.placements).map((p) => [p.ref, p.id]));
    for (const p of room(revised.winner.placements)) expect(p.id).toBe(before.get(p.ref));
    expect(
      room(revised.winner.placements)
        .map((p) => p.ref)
        .toSorted(),
    ).toEqual(['bed', 'ns_left', 'ns_right', 'wardrobe']);
    expect(validateLayout(plan, revised.winner.placements, products)).toEqual([]);
  });
});
