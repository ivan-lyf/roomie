import type { ImageSize } from '@roomie/geometry';
import { ObstacleKind, OpeningKind, type RawPlan, RoomType, type Vec2 } from '@roomie/schema';
import { z } from 'zod';
import {
  PLAN_READ_PROMPT,
  type PlanImage,
  type PlanReader,
  ReaderError,
  type ReaderResult,
  type ReaderUsage,
} from './reader';

// Gemini reads the plan (PLAN.md §5). It answers in its own convention: points [y, x] and boxes
// [ymin, xmin, ymax, xmax] from 0 to 1000 across the image, which is what its vision models are
// trained on; `toRawPlan` turns that into pixels.

const API = 'https://generativelanguage.googleapis.com/v1beta';
/** Gemini's models can think for a few minutes over a detailed plan. */
const TIMEOUT_MS = 300_000;
/** Gemini's free tier is often briefly too busy (503): it's asked again after these pauses. */
const BUSY_RETRY_MS = [5_000, 15_000];

const Point = z.array(z.number()).length(2).describe('[y, x], each 0–1000');
const Box = z.array(z.number()).length(4).describe('[ymin, xmin, ymax, xmax], each 0–1000');

/** The answer Gemini is asked for (see the prompt). */
export const GeminiPlan = z.object({
  walls: z.array(
    z.object({
      start: Point,
      end: Point,
      thickness: z.number().describe('Across the wall, in the same 0–1000 units'),
    }),
  ),
  openings: z.array(
    z.object({
      kind: OpeningKind,
      start: Point,
      end: Point,
      hinge: Point.optional(),
      leafEnd: Point.optional(),
    }),
  ),
  rooms: z.array(z.object({ label: z.string(), type: RoomType, outline: z.array(Point) })),
  fixtures: z.array(z.object({ kind: ObstacleKind, outline: z.array(Point) })),
  texts: z.array(z.object({ text: z.string(), box: Box })),
});
export type GeminiPlan = z.infer<typeof GeminiPlan>;

/** The response schema, as JSON Schema; Gemini doesn't need to know which draft it follows. */
export const RESPONSE_SCHEMA = (() => {
  const schema: Record<string, unknown> = z.toJSONSchema(GeminiPlan);
  delete schema['$schema'];
  return schema;
})();

const Part = z.looseObject({ text: z.string().optional(), thought: z.boolean().optional() });
const Content = z.looseObject({ role: z.string().optional(), parts: z.array(Part).default([]) });
const GeminiResponse = z.object({
  candidates: z
    .array(z.object({ content: Content.optional(), finishReason: z.string().optional() }))
    .default([]),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
    })
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});
type Content = z.infer<typeof Content>;

/** Gemini's 0–1000 coordinates in image pixels. */
export function toRawPlan(plan: GeminiPlan, size: ImageSize): RawPlan {
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1000);
  const point = ([y, x]: number[]): Vec2 => ({
    x: (clamp(x!) / 1000) * size.width,
    y: (clamp(y!) / 1000) * size.height,
  });
  const outline = (points: number[][]) => points.map(point);
  return {
    walls: plan.walls.map((w) => {
      const a = point(w.start);
      const b = point(w.end);
      // Thickness runs across the wall: down the image for a level wall, along it for a plumb one.
      const level = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const across = level ? size.height : size.width;
      return { a, b, thickness: (Math.max(w.thickness, 0) / 1000) * across };
    }),
    openings: plan.openings.map((o) => ({
      kind: o.kind,
      a: point(o.start),
      b: point(o.end),
      ...(o.hinge && o.leafEnd && { swing: { hinge: point(o.hinge), toward: point(o.leafEnd) } }),
    })),
    rooms: plan.rooms
      .filter((r) => r.outline.length >= 3)
      .map((r) => ({
        polygon: outline(r.outline),
        ...(r.label.trim() ? { label: r.label.trim() } : {}),
        type: r.type,
      })),
    obstacles: plan.fixtures
      .filter((f) => f.outline.length >= 3)
      .map((f) => ({ kind: f.kind, polygon: outline(f.outline) })),
    texts: plan.texts.map((t) => {
      const [y0, x0, y1, x1] = t.box.map(clamp) as [number, number, number, number];
      const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
      const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
      return {
        text: t.text,
        bbox: {
          x: (left / 1000) * size.width,
          y: (top / 1000) * size.height,
          w: ((right - left) / 1000) * size.width,
          h: ((bottom - top) / 1000) * size.height,
        },
      };
    }),
  };
}

/** The JSON in an answer, read against the plan's schema; throws with what's wrong. */
function parseAnswer(text: string): GeminiPlan {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`not JSON (${e instanceof Error ? e.message : String(e)})`, { cause: e });
  }
  const parsed = GeminiPlan.safeParse(json);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

export type GeminiOptions = {
  apiKey: string;
  /**
   * Tried in order: the next one reads when one is too busy or out of its quota (on the free
   * tier, a model allows 20 reads a day).
   */
  models: readonly string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** How long to wait before asking a busy Gemini again, once per entry. */
  busyRetryMs?: readonly number[];
};

type ErrorBody = {
  error?: {
    message?: string;
    details?: { violations?: { quotaId?: string; quotaValue?: string }[]; retryDelay?: string }[];
  };
};

/** What a 429 means: a used-up daily quota (and when it resets), or a brief rate limit. */
function limitMessage(model: string, body: ErrorBody | undefined): string {
  const details = body?.error?.details ?? [];
  const daily = details
    .flatMap((d) => d.violations ?? [])
    .find((v) => /PerDay/i.test(v.quotaId ?? ''));
  if (!daily) return `${model} is over its rate limit; try again in a minute.`;
  const delay = details.find((d) => d.retryDelay)?.retryDelay;
  const hours = delay ? Math.ceil(Number.parseFloat(delay) / 3600) : undefined;
  return (
    `${model}'s daily limit (${daily.quotaValue ?? 'a few'} reads on the free tier) is used up` +
    `${hours ? `; it resets in about ${hours} h` : ''}.`
  );
}

/**
 * A plan reader on the Gemini API: one request per plan, and one more when the answer is
 * malformed. A model that's busy or out of its quota hands over to the next.
 */
export function geminiReader(options: GeminiOptions): PlanReader {
  const send = options.fetch ?? fetch;
  const [primary] = options.models;
  if (!primary) throw new Error('The Gemini reader needs a model.');

  /** One request; a busy Gemini (500, 503) is asked again after a pause, twice. */
  async function post(model: string, contents: Content[], signal: AbortSignal) {
    const pauses = options.busyRetryMs ?? BUSY_RETRY_MS;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await send(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
          body: JSON.stringify({
            contents,
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema: RESPONSE_SCHEMA,
              mediaResolution: 'MEDIA_RESOLUTION_HIGH',
            },
          }),
          signal,
        });
      } catch (e) {
        if (signal.aborted) throw new ReaderError("Gemini didn't answer in time.", 504);
        throw new ReaderError(`Gemini couldn't be reached: ${(e as Error).message}`, 502);
      }
      const busy = res.status === 500 || res.status === 503;
      if (res.ok || !busy || attempt >= pauses.length) return res;
      await new Promise((resolve) => setTimeout(resolve, pauses[attempt]));
      if (signal.aborted) throw new ReaderError("Gemini didn't answer in time.", 504);
    }
  }

  async function generate(model: string, contents: Content[], signal: AbortSignal) {
    const res = await post(model, contents, signal);
    if (!res.ok) {
      const body = (await res.json().catch(() => undefined)) as ErrorBody | undefined;
      if (res.status === 429) throw new ReaderError(limitMessage(model, body), 429, true);
      if (res.status === 503 || res.status === 500) {
        const busy = `${model} is too busy right now; try again in a few minutes.`;
        throw new ReaderError(busy, 502, true);
      }
      throw new ReaderError(`Gemini: ${body?.error?.message ?? `HTTP ${res.status}`}`, 502);
    }
    const body = GeminiResponse.parse(await res.json());
    const candidate = body.candidates[0];
    if (!candidate?.content) {
      const reason = body.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'no answer';
      throw new ReaderError(`Gemini gave no plan (${reason}).`, 502);
    }
    const text = candidate.content.parts
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('');
    const usage = body.usageMetadata;
    return {
      content: candidate.content,
      text,
      finishReason: candidate.finishReason,
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      },
    };
  }

  /** Reads the plan with one model, asking again once if its answer is malformed. */
  async function readWith(model: string, image: PlanImage, signal: AbortSignal) {
    const contents: Content[] = [
      {
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: image.mimeType,
              data: Buffer.from(image.bytes).toString('base64'),
            },
          },
          { text: PLAN_READ_PROMPT.text },
        ],
      },
    ];
    const usage: ReaderUsage = { inputTokens: 0, outputTokens: 0 };
    let problem = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await generate(model, contents, signal);
      usage.inputTokens += answer.usage.inputTokens;
      usage.outputTokens += answer.usage.outputTokens;
      try {
        if (answer.finishReason === 'MAX_TOKENS') throw new Error('the answer was cut off');
        const plan = parseAnswer(answer.text);
        return { raw: plan, plan: toRawPlan(plan, image), usage };
      } catch (e) {
        problem = e instanceof Error ? e.message : String(e);
        // Once more, with the answer and what was wrong with it.
        contents.push(answer.content, {
          role: 'user',
          parts: [
            {
              text:
                `That answer doesn't match the response schema: ${problem}\n` +
                'Answer again with the complete plan as JSON that matches it.',
            },
          ],
        });
      }
    }
    throw new ReaderError(`Gemini's answer wasn't a usable plan, twice: ${problem}`, 502);
  }

  return {
    provider: 'gemini',
    model: primary,
    promptVersion: PLAN_READ_PROMPT.version,
    planFromRaw: (raw, size) => toRawPlan(GeminiPlan.parse(raw), size),

    async read(image: PlanImage, signal?: AbortSignal): Promise<ReaderResult> {
      const started = Date.now();
      const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
      const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const unavailable: ReaderError[] = [];
      for (const model of options.models) {
        try {
          const result = await readWith(model, image, both);
          return { ...result, model, durationMs: Date.now() - started };
        } catch (e) {
          if (!(e instanceof ReaderError) || !e.unavailable) throw e;
          unavailable.push(e);
        }
      }
      if (unavailable.length === 1) throw unavailable[0]!;
      const reasons = unavailable.map((e) => e.message).join(' ');
      throw new ReaderError(`No Gemini model could read the plan: ${reasons}`, 429, true);
    },
  };
}
