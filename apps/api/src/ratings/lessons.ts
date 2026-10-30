import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ROOM_FEATURES } from '@roomie/geometry';
import { z } from 'zod';
import type { LayoutConfig } from '../config';
import { readerError, usageOf } from '../plan-reader/claude';
import { ReaderError, type ReaderUsage, spent } from '../plan-reader/reader';

// Lessons from the rating notes (PLAN.md M7): every note, as written and as read, sent to the
// LLM, which proposes general rules backed by them. Ivan keeps, edits or drops each: the ones
// about what goes in a room go into layout-intent.v2; the ones about exact placement that no
// feature measures become new scorer features.

export const RATING_LESSONS_PROMPT = {
  version: 'rating-lessons.v1',
  text: readFileSync(new URL('../prompts/rating-lessons.v1.md', import.meta.url), 'utf8'),
};

const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 300_000;

export const Lesson = z.object({
  rule: z.string().min(1),
  about: z.enum(['what', 'where']),
  feature: z.enum(ROOM_FEATURES as [string, ...string[]]).nullable(),
  ratings: z.array(z.string()),
  strength: z.enum(['strong', 'some']),
});
export type Lesson = z.infer<typeof Lesson>;

const Answer = z.object({ lessons: z.array(Lesson).max(10) });

const FORMAT = (() => {
  const { type, schema } = zodOutputFormat(Answer);
  return { type, schema };
})();

/** A rating's notes, as `ratings:export` writes them to notes.jsonl. */
export type NoteLine = {
  ratingId: string;
  roomType: string | null;
  winner: string;
  livable: boolean | null;
  note: string | null;
  itemNotes: { side: string; note: string; product: string | null }[];
  tags: string[];
  labels: { labels: { problem: string; feature: string | null; rule: string | null }[] } | null;
};

/** The message: the prompt, then every note with how it was read. */
export function lessonsMessage(notes: readonly NoteLine[]): string {
  const lines = notes.map((n) => {
    const parts = [
      `## Rating ${n.ratingId} (${n.roomType ?? 'room'})`,
      `Picked: ${n.winner}${n.livable === null ? '' : `; would live with it: ${n.livable ? 'yes' : 'no'}`}.`,
      n.note ? `Note: ${n.note}` : '',
      ...n.itemNotes
        .filter((i) => i.note.trim() !== '')
        .map((i) => `Item ${i.side.toUpperCase()} (${i.product ?? 'an item'}): ${i.note}`),
      n.tags.length > 0 ? `Room problems: ${n.tags.join(', ')}.` : '',
      ...(n.labels?.labels ?? []).map(
        (l) =>
          `Read as: ${l.problem}; ${l.feature ?? 'no feature'}${l.rule ? `; "${l.rule}"` : ''}`,
      ),
    ];
    return parts.filter(Boolean).join('\n');
  });
  return [RATING_LESSONS_PROMPT.text, '# The notes', ...lines].join('\n\n');
}

/** Lessons backed by ratings there are, and only those. */
export function lessonProblems(lessons: readonly Lesson[], notes: readonly NoteLine[]): string[] {
  const ids = new Set(notes.map((n) => n.ratingId));
  return lessons.flatMap((l, i) => [
    ...(l.ratings.length === 0 ? [`Lesson ${i + 1} names no rating that backs it.`] : []),
    ...l.ratings
      .filter((id) => !ids.has(id))
      .map((id) => `Lesson ${i + 1} names rating ${id}, which isn't one of the notes.`),
  ]);
}

/** The lessons as a page to go through: keep, edit or drop each. */
export function lessonsMarkdown(lessons: readonly Lesson[], notes: number, day: string): string {
  return [
    `# Lessons from ${notes} rated notes, ${day}`,
    '',
    'Keep, edit or drop each. Kept lessons about what goes in a room go into layout-intent.v2;',
    'those about where pieces stand that no feature measures become new scorer features.',
    '',
    ...lessons.map(
      (l, i) =>
        `${i + 1}. **${l.rule}** (${l.about}, ${l.feature ?? 'no feature measures it'}, ` +
        `${l.strength}: ${l.ratings.length} rating${l.ratings.length === 1 ? '' : 's'})`,
    ),
    '',
  ].join('\n');
}

export type LessonOptions = LayoutConfig & {
  client?: { messages: Pick<Anthropic['messages'], 'stream'> };
  timeoutMs?: number;
};

/** Asks for the lessons: once, and once more when the answer is malformed or names no rating. */
export async function proposeLessons(
  notes: readonly NoteLine[],
  options: LessonOptions,
): Promise<{ lessons: Lesson[]; usage: ReaderUsage }> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
  const usage: ReaderUsage = { inputTokens: 0, outputTokens: 0 };
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: lessonsMessage(notes) }];
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
            { signal },
          )
          .finalMessage();
      } catch (e) {
        if (signal.aborted) throw new ReaderError("Claude didn't answer in time.", 504);
        throw readerError(e, options.model);
      }
      usage.inputTokens += usageOf(message).inputTokens;
      usage.outputTokens += usageOf(message).outputTokens;
      messages.push({ role: 'assistant', content: message.content });
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      try {
        if (message.stop_reason === 'max_tokens') throw new Error('the answer was cut off');
        const parsed = Answer.safeParse(JSON.parse(text));
        if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
        const problems = lessonProblems(parsed.data.lessons, notes);
        if (problems.length === 0) return { lessons: parsed.data.lessons, usage };
        problem = problems.join('\n');
      } catch (e) {
        problem = e instanceof Error ? e.message : String(e);
      }
      messages.push({
        role: 'user',
        content: `That answer has problems:\n${problem}\nAnswer again, as JSON that matches the schema.`,
      });
    }
    throw new ReaderError(`Claude's lessons weren't usable, twice: ${problem}`, 502);
  } catch (e) {
    throw spent(e, usage);
  }
}
