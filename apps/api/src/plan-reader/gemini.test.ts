import { describe, expect, it } from 'vitest';
import { geminiReader, type GeminiPlan, RESPONSE_SCHEMA, toRawPlan } from './gemini';
import { PLAN_READ_PROMPT, ReaderError } from './reader';

const image = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png' as const,
  width: 2000,
  height: 1000,
};

const plan: GeminiPlan = {
  walls: [{ start: [100, 50], end: [100, 950], thickness: 20 }],
  openings: [
    { kind: 'door', start: [100, 400], end: [100, 440], hinge: [100, 400], leafEnd: [180, 400] },
  ],
  rooms: [
    {
      label: ' BEDROOM ',
      type: 'bedroom',
      outline: [
        [100, 50],
        [100, 500],
        [900, 500],
        [900, 50],
      ],
    },
  ],
  fixtures: [
    {
      kind: 'counter',
      outline: [
        [800, 600],
        [800, 900],
        [850, 900],
      ],
    },
  ],
  texts: [{ text: 'BEDROOM', box: [400, 200, 430, 300] }],
};

/** A fake Gemini API answering with each body in turn, keeping the requests it got. */
function fakeGemini(...answers: (string | Response)[]) {
  const requests: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    const answer = answers.shift()!;
    if (answer instanceof Response) return answer;
    return Response.json({
      candidates: [{ content: { role: 'model', parts: [{ text: answer }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 50 },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

describe('toRawPlan', () => {
  it("turns Gemini's [y, x] 0–1000 into image pixels", () => {
    const raw = toRawPlan(plan, image);
    expect(raw.walls[0]).toEqual({ a: { x: 100, y: 100 }, b: { x: 1900, y: 100 }, thickness: 20 });
    expect(raw.openings[0]).toEqual({
      kind: 'door',
      a: { x: 800, y: 100 },
      b: { x: 880, y: 100 },
      swing: { hinge: { x: 800, y: 100 }, toward: { x: 800, y: 180 } },
    });
    expect(raw.rooms[0]).toMatchObject({ label: 'BEDROOM', type: 'bedroom' });
    expect(raw.texts[0]).toEqual({ text: 'BEDROOM', bbox: { x: 400, y: 400, w: 200, h: 30 } });
  });

  it('measures a plumb wall’s thickness across the image’s width', () => {
    const raw = toRawPlan(
      { ...plan, walls: [{ start: [0, 500], end: [1000, 500], thickness: 10 }] },
      image,
    );
    expect(raw.walls[0]!.thickness).toBe(20);
  });
});

describe('geminiReader', () => {
  it('sends the image, the prompt and the schema, and reads the answer', async () => {
    const gemini = fakeGemini(JSON.stringify(plan));
    const reader = geminiReader({ apiKey: 'key', models: ['gemini-test'], fetch: gemini.fetch });
    const result = await reader.read(image);
    const [request] = gemini.requests;
    expect(request!.url).toMatch(/models\/gemini-test:generateContent$/);
    expect((request!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('key');
    expect(request!.body).toMatchObject({
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/png', data: 'AQID' } },
            { text: PLAN_READ_PROMPT.text },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_SCHEMA,
      },
    });
    expect(RESPONSE_SCHEMA).not.toHaveProperty('$schema');
    expect(result.raw).toEqual(plan);
    expect(result.plan.walls).toHaveLength(1);
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 250 });
    expect(reader).toMatchObject({ provider: 'gemini', promptVersion: 'plan-read.v2' });
  });

  it('asks once more when the answer is malformed, saying what was wrong', async () => {
    const gemini = fakeGemini('{"walls": "none"}', JSON.stringify(plan));
    const reader = geminiReader({ apiKey: 'key', models: ['m'], fetch: gemini.fetch });
    const result = await reader.read(image);
    expect(result.plan.rooms).toHaveLength(1);
    const retry = gemini.requests[1]!.body['contents'] as {
      role: string;
      parts: { text?: string }[];
    }[];
    expect(retry.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(retry[2]!.parts[0]!.text).toMatch(/doesn't match the response schema: .*walls/s);
    expect(result.usage).toEqual({ inputTokens: 2000, outputTokens: 500 });
  });

  it('gives up cleanly after a second malformed answer', async () => {
    const gemini = fakeGemini('not json', 'still not json');
    const reader = geminiReader({ apiKey: 'key', models: ['m'], fetch: gemini.fetch });
    const error = await reader.read(image).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReaderError);
    expect(error).toMatchObject({
      status: 502,
      message: expect.stringMatching(/twice: not JSON/),
      usage: { inputTokens: 2000, outputTokens: 500 },
    });
  });

  it('says when a model is over its rate limit', async () => {
    const limited = Response.json({ error: { message: 'Quota exceeded' } }, { status: 429 });
    const reader = geminiReader({ apiKey: 'key', models: ['m'], fetch: fakeGemini(limited).fetch });
    await expect(reader.read(image)).rejects.toMatchObject({ status: 429 });
  });

  it('asks a busy Gemini again, and says so when it stays busy', async () => {
    const busy = () => Response.json({ error: { message: 'high demand' } }, { status: 503 });
    const once = fakeGemini(busy(), JSON.stringify(plan));
    const reader = geminiReader({
      apiKey: 'k',
      models: ['m'],
      fetch: once.fetch,
      busyRetryMs: [0, 0],
    });
    expect((await reader.read(image)).plan.walls).toHaveLength(1);
    expect(once.requests).toHaveLength(2);

    const always = fakeGemini(busy(), busy(), busy());
    const stuck = geminiReader({
      apiKey: 'k',
      models: ['m'],
      fetch: always.fetch,
      busyRetryMs: [0, 0],
    });
    await expect(stuck.read(image)).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/too busy/),
    });
    expect(always.requests).toHaveLength(3);
  });

  it("says when a model's daily quota is used up, and when it resets", async () => {
    const daily = Response.json(
      {
        error: {
          message: 'You exceeded your current quota',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [
                { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' },
              ],
            },
            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '48326s' },
          ],
        },
      },
      { status: 429 },
    );
    const reader = geminiReader({
      apiKey: 'k',
      models: ['gemini-a'],
      fetch: fakeGemini(daily).fetch,
    });
    await expect(reader.read(image)).rejects.toMatchObject({
      status: 429,
      message:
        "gemini-a's daily limit (20 reads on the free tier) is used up; it resets in about 14 h.",
    });
  });

  it('hands over to the next model when one is busy or out of quota', async () => {
    const busy = () => Response.json({ error: { message: 'high demand' } }, { status: 503 });
    const gemini = fakeGemini(busy(), busy(), busy(), JSON.stringify(plan));
    const reader = geminiReader({
      apiKey: 'k',
      models: ['gemini-a', 'gemini-b'],
      fetch: gemini.fetch,
      busyRetryMs: [0, 0],
    });
    expect(reader.model).toBe('gemini-a');
    const result = await reader.read(image);
    expect(result.model).toBe('gemini-b');
    expect(gemini.requests.map((r) => r.url.match(/models\/([^:]+)/)![1])).toEqual([
      'gemini-a',
      'gemini-a',
      'gemini-a',
      'gemini-b',
    ]);
  });

  it('gives every reason when no model can read the plan', async () => {
    const limited = () => Response.json({ error: { message: 'slow down' } }, { status: 429 });
    const reader = geminiReader({
      apiKey: 'k',
      models: ['gemini-a', 'gemini-b'],
      fetch: fakeGemini(limited(), limited()).fetch,
    });
    await expect(reader.read(image)).rejects.toMatchObject({
      status: 429,
      message:
        'No Gemini model could read the plan: gemini-a is over its rate limit; try again in a ' +
        'minute. gemini-b is over its rate limit; try again in a minute.',
    });
  });

  it("doesn't hand over a malformed answer: that's the model's own retry", async () => {
    const gemini = fakeGemini('nope', 'still nope', JSON.stringify(plan));
    const reader = geminiReader({ apiKey: 'k', models: ['a', 'b'], fetch: gemini.fetch });
    await expect(reader.read(image)).rejects.toMatchObject({ status: 502 });
    expect(gemini.requests).toHaveLength(2);
  });

  it('reads a cached answer back into pixels', () => {
    const reader = geminiReader({ apiKey: 'key', models: ['m'], fetch: fakeGemini().fetch });
    expect(reader.planFromRaw(plan, image)).toEqual(toRawPlan(plan, image));
  });
});
