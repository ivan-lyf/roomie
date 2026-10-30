import { z } from 'zod';

// Rating layouts (PLAN.md M7): one room from two layouts side by side, which is better, and why in
// the rater's own words. The picks fit the scorer's weights; the notes are read into labels.

/** Never delete ratings; change the status instead. */
export const RatingStatus = z.enum(['active', 'archived']);
export type RatingStatus = z.infer<typeof RatingStatus>;

/** The layout shown on the left (a) or the right (b). */
export const Side = z.enum(['a', 'b']);
export type Side = z.infer<typeof Side>;

/** Which layout was better, or neither. */
export const RatingWinner = z.enum(['a', 'b', 'same']);
export type RatingWinner = z.infer<typeof RatingWinner>;

/** What's wrong with a room as a whole: quick toggles beside the note. */
export const RoomProblem = z.enum([
  'too_full',
  'too_empty',
  'hard_to_walk_through',
  'blocks_a_window',
  'needs_more_seating',
  'pieces_dont_go_together',
]);
export type RoomProblem = z.infer<typeof RoomProblem>;

/** An item flagged as standing in a bad spot, with what's wrong in the rater's words. */
export const ItemNote = z.object({
  side: Side,
  placementId: z.string().min(1),
  note: z.string(),
});
export type ItemNote = z.infer<typeof ItemNote>;

/** The kinds of problem a note can name. */
export const NoteProblem = z.enum([
  'too_far_from',
  'too_close_to',
  'facing_away',
  'blocks',
  'against_window',
  'off_center',
  'wrong_size',
  'missing',
  'not_needed',
  'style',
  'other',
]);
export type NoteProblem = z.infer<typeof NoteProblem>;

/** One problem a note names, as an LLM read it. */
export const NoteLabel = z.object({
  /** The layout it's about, or both when the note says so of both. */
  side: z.enum(['a', 'b', 'both']),
  /** The items it's about, by placement id; none for the room as a whole. */
  items: z.array(z.string().min(1)),
  problem: NoteProblem,
  /** The item it's too far from, too close to, or blocks, by placement id. */
  relativeTo: z.string().min(1).nullable(),
  /** The scorer feature that measures it (a key of weights.json), or null when none does. */
  feature: z.string().min(1).nullable(),
  /** The general rule the note implies, in plain words, if it implies one. */
  rule: z.string().nullable(),
});
export type NoteLabel = z.infer<typeof NoteLabel>;

/** A rating's notes read into labels: by which model and prompt, and whether the rater fixed them. */
export const NoteReading = z.object({
  labels: z.array(NoteLabel),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  corrected: z.boolean(),
});
export type NoteReading = z.infer<typeof NoteReading>;

/** A pair the rating page picked, or a revision asked for in words against its original. */
export const RatingSource = z.enum(['pair', 'told']);
export type RatingSource = z.infer<typeof RatingSource>;

export const Rating = z.object({
  id: z.uuid(),
  /** The layout shown on the left. */
  layoutA: z.uuid(),
  /** The layout shown on the right. */
  layoutB: z.uuid(),
  /** The room compared: rooms are rated one at a time. */
  roomId: z.string().min(1),
  /** Who rated. */
  accountId: z.uuid(),
  winner: RatingWinner,
  /** Whether the rater would live with the winner (with both, when they're the same). */
  livable: z.boolean().nullable(),
  /** Why, in the rater's own words, kept as written. */
  note: z.string().nullable(),
  itemNotes: z.array(ItemNote),
  tags: z.array(RoomProblem),
  /** The note and item notes read into labels; null until they're read. */
  labels: NoteReading.nullable(),
  source: RatingSource,
  /** From the pair showing to the rating saved. */
  seconds: z.number().nonnegative().nullable(),
  status: RatingStatus,
  createdAt: z.coerce.date(),
});
export type Rating = z.infer<typeof Rating>;
