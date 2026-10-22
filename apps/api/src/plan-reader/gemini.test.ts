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
    const reader = geminiReader({ apiKey: 'key', model: 'gemini-test', fetch: gemini.fetch });
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
    expect(reader).toMatchObject({ provider: 'gemini', promptVersion: 'plan-read.v1' });
  });

  it('asks once more when the answer is malformed, saying what was wrong', async () => {
    const gemini = fakeGemini('{"walls": "none"}', JSON.stringify(plan));
    const reader = geminiReader({ apiKey: 'key', model: 'm', fetch: gemini.fetch });
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
    const reader = geminiReader({ apiKey: 'key', model: 'm', fetch: gemini.fetch });
    const error = await reader.read(image).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReaderError);
    expect(error).toMatchObject({ status: 502, message: expect.stringMatching(/twice: not JSON/) });
  });

  it('says when Gemini is over its rate limit', async () => {
    const limited = Response.json({ error: { message: 'Quota exceeded' } }, { status: 429 });
    const reader = geminiReader({ apiKey: 'key', model: 'm', fetch: fakeGemini(limited).fetch });
    await expect(reader.read(image)).rejects.toMatchObject({ status: 429 });
  });

  it('reads a cached answer back into pixels', () => {
    const reader = geminiReader({ apiKey: 'key', model: 'm', fetch: fakeGemini().fetch });
    expect(reader.planFromRaw(plan, image)).toEqual(toRawPlan(plan, image));
  });
});
