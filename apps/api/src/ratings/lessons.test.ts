import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ReaderError } from '../plan-reader/reader';
import {
  type Lesson,
  lessonProblems,
  lessonsMarkdown,
  lessonsMessage,
  type NoteLine,
  proposeLessons,
  RATING_LESSONS_PROMPT,
} from './lessons';

const notes: NoteLine[] = [
  {
    ratingId: 'r-1',
    roomType: 'living_room',
    winner: 'a',
    livable: true,
    note: 'In B the armchair is stranded across the room.',
    itemNotes: [{ side: 'b', note: 'far from everything', product: 'STRANDMON Wing chair' }],
    tags: ['needs_more_seating'],
    labels: {
      labels: [
        { problem: 'too_far_from', feature: 'armchairs', rule: 'Keep the armchair near the sofa.' },
      ],
    },
  },
  {
    ratingId: 'r-2',
    roomType: 'bedroom',
    winner: 'same',
    livable: null,
    note: null,
    itemNotes: [],
    tags: [],
    labels: null,
  },
];

const lesson: Lesson = {
  rule: 'An armchair belongs within reach of the sofa.',
  about: 'where',
  feature: 'armchairs',
  ratings: ['r-1'],
  strength: 'some',
};

function message(text: string): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 3000, output_tokens: 800 },
  } as unknown as Anthropic.Message;
}

const client = (...answers: Anthropic.Message[]) =>
  ({
    messages: { stream: () => ({ finalMessage: async () => answers.shift()! }) },
  }) as unknown as NonNullable<Parameters<typeof proposeLessons>[1]['client']>;

const options = { apiKey: 'k', model: 'claude-test', effort: 'medium' as const };

describe('lessons', () => {
  it('sends every note with how it was read', () => {
    const text = lessonsMessage(notes);
    expect(text.startsWith(RATING_LESSONS_PROMPT.text)).toBe(true);
    expect(text).toContain('## Rating r-1 (living_room)');
    expect(text).toContain('Item B (STRANDMON Wing chair): far from everything');
    expect(text).toContain('Read as: too_far_from; armchairs; "Keep the armchair near the sofa."');
    expect(text).toContain('Picked: same.');
  });

  it('wants every lesson backed by notes there are', () => {
    expect(lessonProblems([lesson], notes)).toEqual([]);
    expect(lessonProblems([{ ...lesson, ratings: [] }], notes)).toEqual([
      'Lesson 1 names no rating that backs it.',
    ]);
    expect(lessonProblems([{ ...lesson, ratings: ['r-9'] }], notes)).toEqual([
      "Lesson 1 names rating r-9, which isn't one of the notes.",
    ]);
  });

  it('asks again once when a lesson names a rating there isn’t, then fails cleanly', async () => {
    const bad = JSON.stringify({ lessons: [{ ...lesson, ratings: ['r-9'] }] });
    const good = JSON.stringify({ lessons: [lesson] });
    const result = await proposeLessons(notes, {
      ...options,
      client: client(message(bad), message(good)),
    });
    expect(result.lessons).toEqual([lesson]);
    expect(result.usage).toEqual({ inputTokens: 6000, outputTokens: 1600 });
    const failed = await proposeLessons(notes, {
      ...options,
      client: client(message(bad), message('nope')),
    }).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ReaderError);
    expect((failed as ReaderError).usage).toEqual({ inputTokens: 6000, outputTokens: 1600 });
  });

  it('writes the lessons as a list to go through', () => {
    expect(lessonsMarkdown([lesson], 2, '2026-11-02')).toContain(
      '1. **An armchair belongs within reach of the sofa.** (where, armchairs, some: 1 rating)',
    );
  });
});
