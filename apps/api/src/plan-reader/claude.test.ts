import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  type ClaudeClient,
  type ClaudePlan,
  claudeBatch,
  claudeReader,
  readingCost,
  sentSize,
  toRawPlan,
} from './claude';
import { PLAN_READ_CLAUDE_PROMPT, ReaderError } from './reader';

const image = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png' as const,
  width: 2000,
  height: 1000,
};

const plan: ClaudePlan = {
  walls: [{ start: [50, 100], end: [1950, 100], thickness: 20 }],
  openings: [
    { kind: 'door', start: [800, 100], end: [880, 100], hinge: [800, 100], leafEnd: [800, 180] },
  ],
  rooms: [
    {
      label: ' BEDROOM ',
      type: 'bedroom',
      outline: [
        [50, 100],
        [1000, 100],
        [1000, 900],
        [50, 900],
      ],
    },
  ],
  fixtures: [],
  texts: [{ text: 'BEDROOM', box: [400, 400, 600, 430] }],
};

/** A message as the API returns it, answering with `text`. */
function message(
  text: string,
  stop: Anthropic.StopReason = 'end_turn',
  stopDetails: Anthropic.Message['stop_details'] = null,
): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stop,
    stop_details: stopDetails,
    stop_sequence: null,
    usage: { input_tokens: 5000, output_tokens: 20000 },
  } as unknown as Anthropic.Message;
}

/** A fake client answering each read with the next answer, keeping the requests it got. */
function fakeClaude(...answers: (Anthropic.Message | Error)[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    messages: {
      stream: (params: Anthropic.MessageCreateParamsNonStreaming) => {
        // A copy: the reader adds to the same messages when it asks again.
        requests.push(structuredClone(params));
        const answer = answers.shift()!;
        return {
          finalMessage: async () => {
            if (answer instanceof Error) throw answer;
            return answer;
          },
        };
      },
      batches: {},
    },
  } as unknown as ClaudeClient;
  return { client, requests };
}

const options = (client: ClaudeClient) => ({
  apiKey: 'key',
  model: 'claude-test',
  effort: 'medium' as const,
  client,
});

describe('toRawPlan', () => {
  it("keeps Claude's pixels when the plan was sent at its own size", () => {
    const raw = toRawPlan(plan, image);
    expect(raw.walls[0]).toEqual({ a: { x: 50, y: 100 }, b: { x: 1950, y: 100 }, thickness: 20 });
    expect(raw.openings[0]).toMatchObject({
      a: { x: 800, y: 100 },
      swing: { hinge: { x: 800, y: 100 }, toward: { x: 800, y: 180 } },
    });
    expect(raw.rooms[0]).toMatchObject({ label: 'BEDROOM', type: 'bedroom' });
    expect(raw.texts[0]).toEqual({ text: 'BEDROOM', bbox: { x: 400, y: 400, w: 200, h: 30 } });
  });

  it('scales the answer back up when the plan was shrunk to send', () => {
    const big = { ...image, width: 3000, height: 2120 };
    expect(sentSize(big)).toEqual({ width: 2576, height: 1820 });
    const raw = toRawPlan(plan, big);
    expect(raw.walls[0]!.b.x).toBeCloseTo(1950 * (3000 / 2576));
    expect(raw.walls[0]!.a.y).toBeCloseTo(100 * (2120 / 1820));
  });
});

describe('claudeReader', () => {
  it('sends the image, the prompt and the schema, and reads the answer', async () => {
    const { client, requests } = fakeClaude(message(JSON.stringify(plan)));
    const reader = claudeReader(options(client));
    expect(reader).toMatchObject({ provider: 'claude', promptVersion: 'plan-read-claude.v1' });

    const result = await reader.read(image);
    expect(result.plan.rooms[0]!.label).toBe('BEDROOM');
    expect(result.usage).toEqual({ inputTokens: 5000, outputTokens: 20000 });
    const [request] = requests;
    expect(request).toMatchObject({
      model: 'claude-test',
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    const [img, text] = request!.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(img).toMatchObject({ type: 'image', source: { type: 'base64', data: 'AQID' } });
    expect(text).toMatchObject({ type: 'text' });
    expect((text as Anthropic.TextBlockParam).text).toContain(PLAN_READ_CLAUDE_PROMPT.text);
    expect((text as Anthropic.TextBlockParam).text).toContain('2000 × 1000 pixels');
  });

  it('shrinks a plan larger than Claude sees at full detail', async () => {
    const png = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const big = { ...image, bytes: new Uint8Array(png), width: 3000, height: 1500 };
    const { client, requests } = fakeClaude(message(JSON.stringify(plan)));
    await claudeReader(options(client)).read(big);
    const [img] = requests[0]!.messages[0]!.content as Anthropic.ImageBlockParam[];
    const data = (img!.source as { data: string }).data;
    const sent = await sharp(Buffer.from(data, 'base64')).metadata();
    expect([sent.width, sent.height]).toEqual([2576, 1288]);
  });

  it('asks once more when the answer is malformed or cut off, saying what was wrong', async () => {
    const { client, requests } = fakeClaude(
      message('{"walls": []}', 'max_tokens'),
      message(JSON.stringify(plan)),
    );
    const result = await claudeReader(options(client)).read(image);
    expect(result.plan.walls).toHaveLength(1);
    expect(result.usage).toEqual({ inputTokens: 10000, outputTokens: 40000 });
    const retry = requests[1]!.messages;
    expect(retry).toHaveLength(3);
    expect(retry[2]!.content).toMatch(/cut off/);
  });

  it('asks again when the answer collapses to no rooms', async () => {
    const empty = { walls: [plan.walls[0]!], openings: [], rooms: [], fixtures: [], texts: [] };
    const { client, requests } = fakeClaude(
      message(JSON.stringify(empty)),
      message(JSON.stringify(plan)),
    );
    const result = await claudeReader(options(client)).read(image);
    expect(result.plan.rooms).toHaveLength(1);
    expect(requests[1]!.messages[2]!.content).toMatch(/no rooms/);
  });

  it('gives up cleanly after a second malformed answer', async () => {
    const { client } = fakeClaude(message('not json'), message('{"walls": 1}'));
    await expect(claudeReader(options(client)).read(image)).rejects.toThrow(
      /wasn't a usable plan, twice/,
    );
  });

  it('says when Claude declines, without asking again', async () => {
    const details = { type: 'refusal', category: 'cyber', explanation: null } as const;
    const declined = message('', 'refusal', details);
    const { client, requests } = fakeClaude(declined);
    await expect(claudeReader(options(client)).read(image)).rejects.toThrow(/declined.*cyber/);
    expect(requests).toHaveLength(1);
  });

  it('says when a model is over its rate limit or too busy, so another could read', async () => {
    const limited = new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers());
    const busy = new Anthropic.InternalServerError(529, undefined, 'overloaded', new Headers());
    for (const error of [limited, busy]) {
      const { client } = fakeClaude(error);
      const failure = await claudeReader(options(client))
        .read(image)
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ReaderError);
      expect((failure as ReaderError).unavailable).toBe(true);
    }
  });

  it('reads a cached answer back into pixels', () => {
    const { client } = fakeClaude();
    const raw = claudeReader(options(client)).planFromRaw(plan, image);
    expect(raw.walls[0]!.a).toEqual({ x: 50, y: 100 });
  });
});

describe('claudeBatch', () => {
  it('reads plans in one batch, and says which failed', async () => {
    const created: unknown[] = [];
    let polls = 0;
    const counts = { processing: 0, succeeded: 1, errored: 1, canceled: 0, expired: 0 };
    const client = {
      messages: {
        batches: {
          create: async (body: unknown) => {
            created.push(body);
            return { id: 'b1', processing_status: 'in_progress', request_counts: counts };
          },
          retrieve: async () => {
            polls++;
            return { id: 'b1', processing_status: 'ended', request_counts: counts };
          },
          results: async () =>
            (async function* () {
              const answer = message(JSON.stringify(plan));
              yield { custom_id: 'a', result: { type: 'succeeded', message: answer } };
              yield {
                custom_id: 'b',
                result: { type: 'errored', error: { type: 'error', error: { message: 'boom' } } },
              };
            })(),
        },
      },
    } as unknown as ClaudeClient;
    const read = await claudeBatch({ ...options(client), pollMs: 0 }, [
      { id: 'a', image },
      { id: 'b', image },
    ]);
    expect(polls).toBe(1);
    const { requests } = created[0] as { requests: { custom_id: string }[] };
    expect(requests.map((r) => r.custom_id)).toEqual(['a', 'b']);
    expect(read.get('a')).toMatchObject({ model: 'claude-test', usage: { outputTokens: 20000 } });
    expect(read.get('b')).toBeInstanceOf(ReaderError);
    expect((read.get('b') as ReaderError).message).toMatch(/boom/);
  });
});

describe('readingCost', () => {
  it('prices a reading, at half for a batch', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(readingCost('claude-opus-5-5', usage)).toBe(24);
    expect(readingCost('claude-opus-5-5', usage, true)).toBe(12);
    expect(readingCost('someone-else', usage)).toBeUndefined();
  });
});
