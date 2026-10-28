import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ImageSize } from '@roomie/geometry';
import { ObstacleKind, OpeningKind, type RawPlan, RoomType, type Vec2 } from '@roomie/schema';
import sharp from 'sharp';
import { z } from 'zod';
import {
  PLAN_READ_CLAUDE_PROMPT,
  type PlanImage,
  type PlanReader,
  ReaderError,
  type ReaderResult,
  type ReaderUsage,
} from './reader';

// Claude reads the plan (PLAN.md §5) in pixels of the image it's sent. Plans are shrunk to the
// largest image current models take at full detail, where their coordinates are the image's own
// pixels; `toRawPlan` scales the answer back to the plan's image.

/** The long edge current Claude models see at full detail. */
const MAX_EDGE = 2576;
/** Answers run 10–25k tokens, plus the model's reasoning. */
const MAX_TOKENS = 64_000;
/** Reading a detailed plan carefully can take a few minutes. */
const TIMEOUT_MS = 600_000;

const Point = z.array(z.number()).length(2).describe('[x, y] in pixels');
const Box = z.array(z.number()).length(4).describe('[x0, y0, x1, y1] in pixels');

/** The answer Claude is asked for (see the prompt): Gemini's, in pixels. */
export const ClaudePlan = z.object({
  walls: z.array(
    z.object({
      start: Point,
      end: Point,
      thickness: z.number().describe('Across the wall, in pixels'),
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
export type ClaudePlan = z.infer<typeof ClaudePlan>;

/** The schema the answer is held to; the answer is checked against `ClaudePlan` here too. */
const FORMAT = (() => {
  const { type, schema } = zodOutputFormat(ClaudePlan);
  return { type, schema };
})();

export const ClaudeEffort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type ClaudeEffort = z.infer<typeof ClaudeEffort>;

/** List prices, $ per million tokens, for pricing eval runs; the Batch API charges half. */
export const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-fable-5-1': { input: 10, output: 50 },
};

/** What a reading cost in dollars, if the model's price is known. */
export function readingCost(model: string, usage: ReaderUsage, batch = false) {
  const price = CLAUDE_PRICES[model];
  if (!price) return undefined;
  const cost = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1e6;
  return batch ? cost / 2 : cost;
}

/** The size a plan is sent at: no larger than the long edge Claude sees at full detail. */
export function sentSize(size: ImageSize): ImageSize {
  const scale = Math.min(1, MAX_EDGE / Math.max(size.width, size.height));
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

/** Claude's pixels, in the image it was sent, as pixels of the plan's own image. */
export function toRawPlan(plan: ClaudePlan, size: ImageSize): RawPlan {
  const sent = sentSize(size);
  const [sx, sy] = [size.width / sent.width, size.height / sent.height];
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const point = ([x, y]: number[]): Vec2 => ({
    x: clamp(x! * sx, size.width),
    y: clamp(y! * sy, size.height),
  });
  const outline = (points: number[][]) => points.map(point);
  return {
    walls: plan.walls.map((w) => ({
      a: point(w.start),
      b: point(w.end),
      thickness: Math.max(w.thickness, 0) * Math.max(sx, sy),
    })),
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
      const [a, b] = [point([t.box[0]!, t.box[1]!]), point([t.box[2]!, t.box[3]!])];
      const [left, top] = [Math.min(a.x, b.x), Math.min(a.y, b.y)];
      return {
        text: t.text,
        bbox: { x: left, y: top, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) },
      };
    }),
  };
}

/** The JSON in an answer, read against the plan's schema; throws with what's wrong. */
function parseAnswer(text: string): ClaudePlan {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`not JSON (${e instanceof Error ? e.message : String(e)})`, { cause: e });
  }
  const parsed = ClaudePlan.safeParse(json);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

/**
 * The plan in an answer. A declined request is a `ReaderError`; an answer cut off or not
 * matching the schema is a plain error, worth asking again about.
 */
function readAnswer(message: Anthropic.Message, size: ImageSize) {
  if (message.stop_reason === 'refusal') {
    const why = message.stop_details?.category ?? 'no reason given';
    throw new ReaderError(`Claude declined to read the plan (${why}).`, 502);
  }
  if (message.stop_reason === 'max_tokens') throw new Error('the answer was cut off');
  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  const plan = parseAnswer(text);
  return { raw: plan, plan: toRawPlan(plan, size) };
}

const usageOf = (message: Anthropic.Message): ReaderUsage => ({
  inputTokens:
    message.usage.input_tokens +
    (message.usage.cache_read_input_tokens ?? 0) +
    (message.usage.cache_creation_input_tokens ?? 0),
  outputTokens: message.usage.output_tokens,
});

/** The SDK's errors as reader errors: a busy or rate-limited model can be tried again later. */
function readerError(e: unknown, model: string): ReaderError {
  if (e instanceof ReaderError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new ReaderError("Claude didn't answer in time.", 504);
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new ReaderError(`${model} is over its rate limit; try again in a minute.`, 429, true);
  }
  if (e instanceof Anthropic.InternalServerError) {
    const busy = `${model} is too busy right now; try again in a few minutes.`;
    return new ReaderError(busy, 502, true);
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ReaderError(`Claude couldn't be reached: ${e.message}`, 502);
  }
  if (e instanceof Anthropic.APIError) return new ReaderError(`Claude: ${e.message}`, 502);
  throw e;
}

/** The parts of the SDK client the reader uses, so tests can stand in for it. */
export type ClaudeClient = {
  messages: Pick<Anthropic['messages'], 'stream'> & {
    batches: Pick<Anthropic['messages']['batches'], 'create' | 'retrieve' | 'results'>;
  };
};

export type ClaudeOptions = {
  apiKey: string;
  model: string;
  effort: ClaudeEffort;
  client?: ClaudeClient;
  timeoutMs?: number;
};

/** The request that reads one plan: the image at the size it's sent, then the prompt. */
async function planRequest(
  image: PlanImage,
  options: Pick<ClaudeOptions, 'model' | 'effort'>,
): Promise<Anthropic.MessageCreateParamsNonStreaming> {
  const sent = sentSize(image);
  let bytes = image.bytes;
  if (sent.width !== image.width || sent.height !== image.height) {
    const resized = sharp(image.bytes).resize(sent.width, sent.height, { fit: 'fill' });
    const out = image.mimeType === 'image/png' ? resized.png() : resized.jpeg({ quality: 92 });
    bytes = new Uint8Array(await out.toBuffer());
  }
  return {
    model: options.model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: options.effort, format: FORMAT },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mimeType,
              data: Buffer.from(bytes).toString('base64'),
            },
          },
          {
            type: 'text',
            text:
              `${PLAN_READ_CLAUDE_PROMPT.text}\n` +
              `The image is ${sent.width} × ${sent.height} pixels.`,
          },
        ],
      },
    ],
  };
}

/**
 * A plan reader on the Claude API: one streamed request per plan, and one more when the answer
 * is cut off or malformed.
 */
export function claudeReader(options: ClaudeOptions): PlanReader {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  async function readOnce(params: Anthropic.MessageCreateParamsNonStreaming, signal: AbortSignal) {
    try {
      return await client.messages.stream(params, { signal }).finalMessage();
    } catch (e) {
      if (signal.aborted) throw new ReaderError("Claude didn't answer in time.", 504);
      throw readerError(e, options.model);
    }
  }

  return {
    provider: 'claude',
    model: options.model,
    promptVersion: PLAN_READ_CLAUDE_PROMPT.version,
    planFromRaw: (raw, size) => toRawPlan(ClaudePlan.parse(raw), size),

    async read(image: PlanImage, signal?: AbortSignal): Promise<ReaderResult> {
      const started = Date.now();
      const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
      const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const params = await planRequest(image, options);
      const usage: ReaderUsage = { inputTokens: 0, outputTokens: 0 };
      let problem = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const message = await readOnce(params, both);
        usage.inputTokens += usageOf(message).inputTokens;
        usage.outputTokens += usageOf(message).outputTokens;
        try {
          const read = readAnswer(message, image);
          return { ...read, model: options.model, usage, durationMs: Date.now() - started };
        } catch (e) {
          if (e instanceof ReaderError) throw e;
          problem = e instanceof Error ? e.message : String(e);
          // Once more, with the answer and what was wrong with it.
          params.messages.push(
            { role: 'assistant', content: message.content },
            {
              role: 'user',
              content:
                `That answer isn't usable: ${problem}\n` +
                'Answer again with the complete plan as JSON that matches the schema.',
            },
          );
        }
      }
      throw new ReaderError(`Claude's answer wasn't a usable plan, twice: ${problem}`, 502);
    },
  };
}

/**
 * Reads several plans in one batch, at half price: submits them, waits until the batch ends,
 * and gives each plan's reading, or why it failed (a failure can be read again live).
 */
export async function claudeBatch(
  options: ClaudeOptions & { pollMs?: number; onStatus?: (status: string) => void },
  plans: readonly { id: string; image: PlanImage }[],
): Promise<Map<string, ReaderResult | ReaderError>> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const started = Date.now();
  const requests = await Promise.all(
    plans.map(async ({ id, image }) => ({
      custom_id: id,
      params: await planRequest(image, options),
    })),
  );
  let batch;
  try {
    batch = await client.messages.batches.create({ requests });
    while (batch.processing_status !== 'ended') {
      const { processing, succeeded, errored } = batch.request_counts;
      options.onStatus?.(`${processing} reading, ${succeeded} done, ${errored} failed`);
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 30_000));
      batch = await client.messages.batches.retrieve(batch.id);
    }
  } catch (e) {
    throw readerError(e, options.model);
  }

  const images = new Map(plans.map((p) => [p.id, p.image]));
  const out = new Map<string, ReaderResult | ReaderError>();
  for await (const entry of await client.messages.batches.results(batch.id)) {
    const image = images.get(entry.custom_id);
    if (!image) continue;
    if (entry.result.type !== 'succeeded') {
      const why =
        entry.result.type === 'errored' ? entry.result.error.error.message : entry.result.type;
      out.set(entry.custom_id, new ReaderError(`Claude's batch didn't read it: ${why}`, 502));
      continue;
    }
    const message = entry.result.message;
    try {
      out.set(entry.custom_id, {
        ...readAnswer(message, image),
        model: options.model,
        usage: usageOf(message),
        durationMs: Date.now() - started,
      });
    } catch (e) {
      const problem = e instanceof Error ? e.message : String(e);
      out.set(entry.custom_id, e instanceof ReaderError ? e : new ReaderError(problem, 502));
    }
  }
  return out;
}
