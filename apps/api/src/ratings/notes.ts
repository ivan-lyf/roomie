import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ROOM_FEATURES } from '@roomie/geometry';
import {
  type Floorplan,
  NoteLabel,
  type Placement,
  type Product,
  type Rating,
  type Side,
} from '@roomie/schema';
import { z } from 'zod';
import { describeRoom } from '../layouts/describe';
import { type ClaudeEffort, readerError, usageOf } from '../plan-reader/claude';
import { ReaderError, type ReaderUsage, spent } from '../plan-reader/reader';

// Reading a rating's notes (PLAN.md M7): what the rater wrote in their own words, read by an LLM
// into labels (which items, what's wrong, which scorer feature it bears on, and the rule it
// implies), checked against what each layout holds. The notes stay as they were written.

/** The prompt that reads notes, versioned: every reading records which one it used. */
export const RATING_NOTE_PROMPT = {
  version: 'rating-note.v1',
  text: readFileSync(new URL('../prompts/rating-note.v1.md', import.meta.url), 'utf8'),
};

/** Labels run short; a note is a sentence or two. */
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 60_000;
/** Reading a note is simple: no need to think long. */
const EFFORT: ClaudeEffort = 'low';

/** The answer: the labels, with the feature one the scorer knows, or none. */
const NoteAnswer = z.object({
  labels: z.array(
    NoteLabel.extend({ feature: z.enum(ROOM_FEATURES as [string, ...string[]]).nullable() }),
  ),
});

const FORMAT = (() => {
  const { type, schema } = zodOutputFormat(NoteAnswer);
  return { type, schema };
})();

/** A rating's notes and everything they talk about. */
export type NoteRequest = {
  plan: Floorplan;
  roomId: string;
  /** The room's items in each layout. */
  sides: Record<Side, readonly Placement[]>;
  products: ReadonlyMap<string, Product>;
  rating: Pick<Rating, 'winner' | 'livable' | 'note' | 'itemNotes' | 'tags'>;
};

export type NoteResult = { labels: NoteLabel[]; model: string; usage: ReaderUsage };

export interface NoteReader {
  model: string;
  promptVersion: string;
  read(request: NoteRequest, signal?: AbortSignal): Promise<NoteResult>;
}

/** Whether a rating has anything written to read. */
export const hasNotes = (rating: Pick<Rating, 'note' | 'itemNotes'>) =>
  Boolean(rating.note?.trim()) || rating.itemNotes.some((n) => n.note.trim() !== '');

/** An item as the reader sees it: its id, category and product. */
function itemLine(placement: Placement, products: ReadonlyMap<string, Product>): string {
  const product = products.get(placement.articleNo);
  return product
    ? `- ${placement.id}: ${product.category.replace(/_/g, ' ')} (${product.name})`
    : `- ${placement.id}: an item`;
}

const WINNERS: Record<Rating['winner'], string> = {
  a: 'A',
  b: 'B',
  same: 'neither: about the same',
};

/** The message: the prompt, the room, what each layout holds, and what the rater said. */
export function noteMessage(request: NoteRequest): string {
  const { plan, roomId, sides, products, rating } = request;
  const room = plan.rooms.find((r) => r.id === roomId);
  const items = (side: Side) =>
    sides[side].map((p) => itemLine(p, products)).join('\n') || '- Nothing.';
  const flagged = rating.itemNotes.map((n) => {
    const placement = sides[n.side].find((p) => p.id === n.placementId);
    const what = placement ? products.get(placement.articleNo)?.name : undefined;
    const text = n.note.trim() || '(flagged as in a bad spot, with nothing written)';
    return `- ${n.side.toUpperCase()} ${n.placementId}${what ? ` (${what})` : ''}: ${text}`;
  });
  return [
    RATING_NOTE_PROMPT.text,
    '# The room',
    room ? describeRoom(plan, room) : `Room ${roomId}.`,
    '# Layout A holds',
    items('a'),
    '# Layout B holds',
    items('b'),
    '# What they said',
    [
      `Picked: ${WINNERS[rating.winner]}.`,
      rating.livable === null ? '' : `Would live with it: ${rating.livable ? 'yes' : 'no'}.`,
      rating.tags.length > 0 ? `Room problems ticked: ${rating.tags.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    `Note: ${rating.note?.trim() || '(none)'}`,
    flagged.length > 0 ? `Items flagged:\n${flagged.join('\n')}` : 'Items flagged: none.',
  ].join('\n\n');
}

/** What's wrong with labels for this request: items that aren't where the label says. */
export function labelProblems(labels: readonly NoteLabel[], request: NoteRequest): string[] {
  const on = (side: NoteLabel['side'], id: string) =>
    (side === 'both' ? [...request.sides.a, ...request.sides.b] : request.sides[side]).some(
      (p) => p.id === id,
    );
  return labels.flatMap((label, i) =>
    [...label.items, ...(label.relativeTo ? [label.relativeTo] : [])]
      .filter((id) => !on(label.side, id))
      .map((id) => `Label ${i + 1}: layout ${label.side.toUpperCase()} has no item ${id}.`),
  );
}

export type NoteClient = { messages: Pick<Anthropic['messages'], 'stream'> };

export type NoteReaderOptions = {
  apiKey: string;
  model: string;
  /** Instead of the real API, in tests. */
  client?: NoteClient;
  timeoutMs?: number;
};

/** The labels in an answer; throws with what's wrong when it's cut off or malformed. */
function readAnswer(message: Anthropic.Message): NoteLabel[] {
  if (message.stop_reason === 'refusal') {
    const why = message.stop_details?.category ?? 'no reason given';
    throw new ReaderError(`Claude declined to read the note (${why}).`, 502);
  }
  if (message.stop_reason === 'max_tokens') throw new Error('the answer was cut off');
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`not JSON (${e instanceof Error ? e.message : String(e)})`, { cause: e });
  }
  const parsed = NoteAnswer.safeParse(json);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data.labels;
}

/**
 * A note reader on the Claude API: one request per rating, and one more when the answer is cut
 * off, malformed, or names items the layouts don't have.
 */
export function claudeNoteReader(options: NoteReaderOptions): NoteReader {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  return {
    model: options.model,
    promptVersion: RATING_NOTE_PROMPT.version,
    async read(request, signal) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
      const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const usage: ReaderUsage = { inputTokens: 0, outputTokens: 0 };
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: noteMessage(request) }];
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
                  output_config: { effort: EFFORT, format: FORMAT },
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
            const labels = readAnswer(message);
            const problems = labelProblems(labels, request);
            if (problems.length === 0) return { labels, model: options.model, usage };
            problem = problems.join('\n');
          } catch (e) {
            if (e instanceof ReaderError) throw e;
            problem = e instanceof Error ? e.message : String(e);
          }
          messages.push({
            role: 'user',
            content:
              `That answer has problems:\n${problem}\n` +
              'Answer again with every label, as JSON that matches the schema.',
          });
        }
        throw new ReaderError(`Claude's labels weren't usable, twice: ${problem}`, 502);
      } catch (e) {
        // What was used before it failed still costs that.
        throw spent(e, usage);
      }
    },
  };
}
