import type Anthropic from '@anthropic-ai/sdk';
import { Floorplan, LayoutIntent, Product } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import intentJson from '../../../../fixtures/plans/00-demo-1br/intent.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { pickCandidates } from './candidates';
import {
  claudeIntentWriter,
  type IntentClient,
  type IntentRequest,
  inputsText,
  intentProblems,
  LAYOUT_INTENT_PROMPT,
} from './intent';

const plan = Floorplan.parse(demo);
const intent = LayoutIntent.parse(intentJson);
const inputs = {
  roomIds: ['r1', 'r2'],
  budgetCad: 3000,
  style: 'scandinavian' as const,
  mustHaves: { r1: ['wardrobe' as const] },
};
const request: IntentRequest = {
  plan,
  inputs,
  candidates: pickCandidates(plan, Product.array().parse(catalog), inputs),
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
    usage: { input_tokens: 9000, output_tokens: 3000 },
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
  } as unknown as IntentClient;
  return { client, requests };
}

const writer = (client: IntentClient) =>
  claudeIntentWriter({ apiKey: 'k', model: 'claude-test', effort: 'medium', client });

describe('inputsText', () => {
  it('says what was asked for in words', () => {
    expect(inputsText(plan, inputs)).toBe(
      [
        'Rooms to furnish: Bedroom (r1), Living (r2).',
        'Budget: $3,000 CAD for everything.',
        'Style: scandinavian (light & natural: pale wood, white, soft textiles).',
        'Must have: Bedroom (r1): wardrobe.',
      ].join('\n'),
    );
  });
});

describe('intentProblems', () => {
  it('passes the hand-written intent', () => {
    expect(intentProblems(intent, request)).toEqual([]);
  });

  it('finds a missing room or must-have, and a budget overrun', () => {
    const bedroom = intent.rooms[0]!;
    const without = { ...bedroom, items: bedroom.items.filter((i) => i.ref !== 'wardrobe') };
    const relations = bedroom.relations.filter((r) => !('item' in r) || r.item !== 'wardrobe');
    const tight = { ...request, inputs: { ...inputs, budgetCad: 600 } };
    expect(intentProblems({ ...intent, rooms: [{ ...without, relations }] }, tight)).toEqual([
      'Bedroom (r1) must have a wardrobe, and has none.',
      "Living (r2) wasn't furnished.",
      // A $399 bed, two $79 nightstands and a $129 rug.
      'Everything adds up to $686, $86 over the $600 budget: choose cheaper or fewer pieces.',
    ]);
  });
});

describe('claudeIntentWriter', () => {
  it('sends the home, the request and the catalog, and reads the intent', async () => {
    const { client, requests } = fakeClaude(message(JSON.stringify(intent)));
    const result = await writer(client).write(request);
    expect(result.intent).toEqual(intent);
    expect(result.problems).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 9000, outputTokens: 3000 });
    const text = requests[0]!.messages[0]!.content as string;
    expect(text).toContain(LAYOUT_INTENT_PROMPT.text);
    expect(text).toContain('Room r1: Bedroom (bedroom)');
    expect(text).toContain('- 900.000.15 | TEST Three-seat sofa | $899.00');
    expect(requests[0]).toMatchObject({ output_config: { format: { type: 'json_schema' } } });
  });

  it('asks once more about a broken answer, saying what was wrong', async () => {
    const wrong = { ...intent, rooms: intent.rooms.slice(0, 1) };
    const { client, requests } = fakeClaude(
      message(JSON.stringify(wrong)),
      message(JSON.stringify(intent)),
    );
    const result = await writer(client).write(request);
    expect(result.problems).toEqual([]);
    expect(requests[1]!.messages[2]!.content).toMatch(/Living \(r2\) wasn't furnished/);
  });

  it('keeps an answer that still has problems after asking again, with them listed', async () => {
    const wrong = { ...intent, rooms: intent.rooms.slice(0, 1) };
    const { client } = fakeClaude(message(JSON.stringify(wrong)), message(JSON.stringify(wrong)));
    const result = await writer(client).write(request);
    expect(result.problems).toEqual(["Living (r2) wasn't furnished."]);
  });

  it('fails cleanly after two unusable answers', async () => {
    const { client } = fakeClaude(message('{"rooms":', 'max_tokens'), message('not json'));
    await expect(writer(client).write(request)).rejects.toThrow(/wasn't a usable intent, twice/);
  });

  it('asks for a repair in the same conversation', async () => {
    const { client, requests } = fakeClaude(
      message(JSON.stringify(intent)),
      message(JSON.stringify(intent)),
    );
    const w = writer(client);
    const first = await w.write(request);
    await w.repair(first, request, "The 1.60 × 2.10 m bed doesn't fit in the Bedroom.");
    const repair = requests[1]!.messages;
    expect(repair).toHaveLength(3);
    expect(repair[2]!.content).toMatch(/couldn't place everything:\nThe 1.60 × 2.10 m bed/);
  });
});
