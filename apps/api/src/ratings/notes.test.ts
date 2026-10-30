import type Anthropic from '@anthropic-ai/sdk';
import { ROOM_FEATURES } from '@roomie/geometry';
import { Floorplan, type Placement, Product } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { ReaderError } from '../plan-reader/reader';
import {
  claudeNoteReader,
  hasNotes,
  labelProblems,
  type NoteClient,
  noteMessage,
  type NoteRequest,
  RATING_NOTE_PROMPT,
} from './notes';

const plan = Floorplan.parse(demo);
const products = new Map(
  Product.array()
    .parse(catalog)
    .map((p) => [p.articleNo, p]),
);
const [sofa, table] = [...products.values()];
const at = (id: string, articleNo: string, x: number): Placement => ({
  id,
  articleNo,
  roomId: 'r2',
  x,
  y: 2,
  rotation: 0,
});
const request: NoteRequest = {
  plan,
  roomId: 'r2',
  sides: {
    a: [at('f1', sofa!.articleNo, 2), at('f2', table!.articleNo, 3)],
    b: [at('f5', sofa!.articleNo, 1), at('f6', table!.articleNo, 4)],
  },
  products,
  rating: {
    winner: 'a',
    livable: true,
    note: 'In B the table is too far from the sofa.',
    itemNotes: [{ side: 'b', placementId: 'f6', note: 'out in the middle of nowhere' }],
    tags: ['too_empty'],
  },
};

const label = {
  side: 'b' as const,
  items: ['f6'],
  problem: 'too_far_from' as const,
  relativeTo: 'f5',
  feature: 'relations',
  rule: 'A coffee table belongs in front of the sofa.',
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
    usage: { input_tokens: 1500, output_tokens: 200 },
  } as unknown as Anthropic.Message;
}

function fakeClaude(...answers: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    messages: {
      stream: (params: Anthropic.MessageCreateParamsNonStreaming) => {
        requests.push(structuredClone(params));
        const answer = answers.shift()!;
        return { finalMessage: async () => answer };
      },
    },
  } as unknown as NoteClient;
  return { client, requests };
}

const reader = (client: NoteClient) =>
  claudeNoteReader({ apiKey: 'k', model: 'claude-test', client });

describe('noteMessage', () => {
  it('gives the prompt, the room, what each layout holds, and what the rater said', () => {
    const text = noteMessage(request);
    expect(text.startsWith(RATING_NOTE_PROMPT.text)).toBe(true);
    expect(text).toContain('Room r2: Living');
    expect(text).toContain(`- f6: ${table!.category.replace(/_/g, ' ')} (${table!.name})`);
    expect(text).toContain('Picked: A.');
    expect(text).toContain('Room problems ticked: too_empty.');
    expect(text).toContain('Note: In B the table is too far from the sofa.');
    expect(text).toContain(`- B f6 (${table!.name}): out in the middle of nowhere`);
  });

  it('describes every feature the scorer weighs in the prompt', () => {
    for (const feature of ROOM_FEATURES)
      expect(RATING_NOTE_PROMPT.text).toContain(`\`${feature}\``);
  });
});

describe('labelProblems', () => {
  it('finds labels naming items the layout they name has not got', () => {
    expect(labelProblems([label], request)).toEqual([]);
    expect(labelProblems([{ ...label, side: 'a' }], request)).toEqual([
      'Label 1: layout A has no item f6.',
      'Label 1: layout A has no item f5.',
    ]);
    // Of both: either layout's items will do.
    expect(labelProblems([{ ...label, side: 'both', relativeTo: 'f1' }], request)).toEqual([]);
  });
});

describe('hasNotes', () => {
  it('says whether anything was written', () => {
    expect(hasNotes({ note: null, itemNotes: [] })).toBe(false);
    expect(hasNotes({ note: '  ', itemNotes: [{ side: 'a', placementId: 'f1', note: '' }] })).toBe(
      false,
    );
    expect(
      hasNotes({ note: null, itemNotes: [{ side: 'a', placementId: 'f1', note: 'odd' }] }),
    ).toBe(true);
  });
});

describe('claudeNoteReader', () => {
  it('reads the notes into labels, with low effort and structured output', async () => {
    const { client, requests } = fakeClaude(message(JSON.stringify({ labels: [label] })));
    const result = await reader(client).read(request);
    expect(result).toEqual({
      labels: [label],
      model: 'claude-test',
      usage: { inputTokens: 1500, outputTokens: 200 },
    });
    expect(requests[0]!.output_config).toMatchObject({
      effort: 'low',
      format: { type: 'json_schema' },
    });
  });

  it('asks again once when the labels name items that are not there, or are malformed', async () => {
    const wrong = { ...label, items: ['f9'] };
    const { client, requests } = fakeClaude(
      message(JSON.stringify({ labels: [wrong] })),
      message(JSON.stringify({ labels: [label] })),
    );
    const result = await reader(client).read(request);
    expect(result.labels).toEqual([label]);
    expect(result.usage).toEqual({ inputTokens: 3000, outputTokens: 400 });
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('layout B has no item f9');

    const twice = fakeClaude(
      message('not json'),
      message(JSON.stringify({ labels: [{ ...label, feature: 'vibes' }] })),
    );
    const failed = await reader(twice.client)
      .read(request)
      .catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ReaderError);
    // What it used before it failed still costs that.
    expect((failed as ReaderError).usage).toEqual({ inputTokens: 3000, outputTokens: 400 });
  });

  it('fails cleanly when the answer is refused or cut off', async () => {
    const refused = fakeClaude(message('', 'refusal'));
    await expect(reader(refused.client).read(request)).rejects.toThrow(/declined/);
    const cut = fakeClaude(
      message('{"labels": [', 'max_tokens'),
      message('{"labels": [', 'max_tokens'),
    );
    await expect(reader(cut.client).read(request)).rejects.toThrow(/cut off/);
  });
});
