import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { bounds, roomContext } from '@roomie/geometry';
import {
  type Floorplan,
  ItemRef,
  type Placement,
  type Product,
  Relation,
  relationRefs,
  type RoomIntent,
} from '@roomie/schema';
import { z } from 'zod';
import type { LayoutConfig } from '../config';
import { compass, describeRoom } from '../layouts/describe';
import { readerError, usageOf } from '../plan-reader/claude';
import { ReaderError, type ReaderUsage, spent } from '../plan-reader/reader';

// "Tell it" (PLAN.md M7): a rater says in words what should change in a room, and the LLM
// revises the room's intent, with the pieces it has: its relations, its reasons, and which items
// stay. Never coordinates: the solver places the revision, as it placed the original.

/** The prompt that revises a room, versioned: the revision's layout records which one it used. */
export const REVISE_ROOM_PROMPT = {
  version: 'revise-room.v1',
  text: readFileSync(new URL('../prompts/revise-room.v1.md', import.meta.url), 'utf8'),
};

const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 120_000;

/** The answer: the items that stay, the relations, and what couldn't be done. */
const Revision = z.object({
  items: z.array(z.object({ ref: ItemRef, why: z.string() })),
  relations: z.array(Relation),
  cannot: z.string().nullable(),
});
type Revision = z.infer<typeof Revision>;

const FORMAT = (() => {
  const { type, schema } = zodOutputFormat(Revision);
  return { type, schema };
})();

/** What a revision is asked from: the room, its plan, where its items stand, and the words. */
export type ReviseRequest = {
  plan: Floorplan;
  /** The room's plan now. */
  intent: RoomIntent;
  /** The room's items as placed, each by the ref it was solved under. */
  placements: readonly Placement[];
  products: ReadonlyMap<string, Product>;
  words: string;
};

export type ReviseResult = {
  intent: RoomIntent;
  cannot: string | null;
  model: string;
  usage: ReaderUsage;
};

export interface RoomReviser {
  model: string;
  promptVersion: string;
  revise(request: ReviseRequest, signal?: AbortSignal): Promise<ReviseResult>;
}

const m = (v: number) => `${v.toFixed(1)} m`;

/** Where each item stands, in words: how far from the room's north-west corner, which way it faces. */
function whereText(request: ReviseRequest): string {
  const { plan, intent, placements, products } = request;
  const ctx = roomContext(plan, intent.roomId);
  const corner = ctx ? bounds(ctx.floor).min : { x: 0, y: 0 };
  return placements
    .map((p) => {
      const product = products.get(p.articleNo);
      // Rotation 0 faces +y, south on the plan (CLAUDE.md), as the scorer's front.
      const facing = compass({ x: Math.sin(p.rotation), y: Math.cos(p.rotation) });
      return (
        `- ${p.ref ?? p.id}: ${product?.category.replace(/_/g, ' ') ?? 'item'}, its middle ` +
        `${m(p.x - corner.x)} east and ${m(p.y - corner.y)} south of the north-west corner, ` +
        `facing ${facing}`
      );
    })
    .join('\n');
}

/** The message: the prompt, the room, its plan now, where things stand, and what was said. */
export function reviseMessage(request: ReviseRequest): string {
  const { plan, intent, products, words } = request;
  const room = plan.rooms.find((r) => r.id === intent.roomId);
  const items = intent.items
    .map((i) => {
      const product = products.get(i.articleNo);
      const what = product ? `${product.category.replace(/_/g, ' ')}, ${product.name}` : 'item';
      return `- ${i.ref}: ${what}. ${i.why}`;
    })
    .join('\n');
  return [
    REVISE_ROOM_PROMPT.text,
    '# The room',
    room ? describeRoom(plan, room) : `Room ${intent.roomId}.`,
    "# The room's plan now",
    items,
    `Relations: ${JSON.stringify(intent.relations)}`,
    '# Where the layout program put them',
    whereText(request),
    '# What they said should change',
    words,
  ].join('\n\n');
}

/** What's wrong with a revision: items the room hasn't got, or relations to items gone. */
export function revisionProblems(revision: Revision, intent: RoomIntent): string[] {
  const had = new Set(intent.items.map((i) => i.ref));
  const kept = new Set(revision.items.map((i) => i.ref));
  const problems = [
    ...revision.items
      .filter((i) => !had.has(i.ref))
      .map((i) => `There's no ${i.ref} in the room: arrange only the items listed.`),
    ...[...kept]
      .filter((ref) => revision.items.filter((i) => i.ref === ref).length > 1)
      .map((ref) => `${ref} is listed twice.`),
    ...revision.relations.flatMap((r) =>
      relationRefs(r)
        .filter((ref) => !kept.has(ref))
        .map((ref) => `A ${r.kind} relation names ${ref}, which isn't one of the items that stay.`),
    ),
  ];
  if (revision.items.length === 0) problems.push('Keep at least one item.');
  return problems;
}

export type ReviserOptions = LayoutConfig & {
  /** Instead of the real API, in tests. */
  client?: { messages: Pick<Anthropic['messages'], 'stream'> };
  timeoutMs?: number;
};

/** The revision in an answer; throws with what's wrong when it's cut off or malformed. */
function readAnswer(message: Anthropic.Message): Revision {
  if (message.stop_reason === 'refusal') {
    const why = message.stop_details?.category ?? 'no reason given';
    throw new ReaderError(`Claude declined to revise the room (${why}).`, 502);
  }
  if (message.stop_reason === 'max_tokens') throw new Error('the answer was cut off');
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`not JSON (${e instanceof Error ? e.message : String(e)})`, { cause: e });
  }
  const parsed = Revision.safeParse(json);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

/**
 * A room reviser on the Claude API: one request, and one more when the answer is cut off,
 * malformed, or arranges items the room hasn't got.
 */
export function claudeRoomReviser(options: ReviserOptions): RoomReviser {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  return {
    model: options.model,
    promptVersion: REVISE_ROOM_PROMPT.version,
    async revise(request, signal) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
      const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const usage: ReaderUsage = { inputTokens: 0, outputTokens: 0 };
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: reviseMessage(request) },
      ];
      let problem = '';
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          let message: Anthropic.Message;
          try {
            message = await client.messages
              .stream(
                {
                  model: options.model,
                  max_tokens: MAX_TOKENS,
                  output_config: { effort: options.effort, format: FORMAT },
                  messages,
                },
                { signal: both },
              )
              .finalMessage();
          } catch (e) {
            if (both.aborted) throw new ReaderError("Claude didn't answer in time.", 504);
            throw readerError(e, options.model);
          }
          usage.inputTokens += usageOf(message).inputTokens;
          usage.outputTokens += usageOf(message).outputTokens;
          messages.push({ role: 'assistant', content: message.content });
          try {
            const revision = readAnswer(message);
            const problems = revisionProblems(revision, request.intent);
            if (problems.length === 0) {
              const articleNo = new Map(request.intent.items.map((i) => [i.ref, i.articleNo]));
              const intent: RoomIntent = {
                roomId: request.intent.roomId,
                items: revision.items.map((i) => ({ ...i, articleNo: articleNo.get(i.ref)! })),
                relations: revision.relations,
              };
              return { intent, cannot: revision.cannot, model: options.model, usage };
            }
            problem = problems.join('\n');
          } catch (e) {
            if (e instanceof ReaderError) throw e;
            problem = e instanceof Error ? e.message : String(e);
          }
          messages.push({
            role: 'user',
            content:
              `That answer has problems:\n${problem}\n` +
              'Answer again with the whole revised plan, as JSON that matches the schema.',
          });
        }
        throw new ReaderError(`Claude's revision wasn't usable, twice: ${problem}`, 502);
      } catch (e) {
        // What was used before it failed still costs that.
        throw spent(e, usage);
      }
    },
  };
}
