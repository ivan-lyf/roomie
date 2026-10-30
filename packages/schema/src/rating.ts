import { z } from 'zod';
import { Floorplan } from './floorplan';
import { Placement } from './layout';

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

/** What the rating page sends: the server adds who rated, and when. */
export const RatingInput = Rating.pick({
  layoutA: true,
  layoutB: true,
  roomId: true,
  winner: true,
  livable: true,
  note: true,
  itemNotes: true,
  tags: true,
  source: true,
  seconds: true,
});
export type RatingInput = z.infer<typeof RatingInput>;

/** One room as one layout has it. */
export const RoomVersion = z.object({
  layoutId: z.uuid(),
  /** The room's items in this layout. */
  placements: z.array(Placement),
});
export type RoomVersion = z.infer<typeof RoomVersion>;

/** The next pair to rate: one room of a home, from two layouts. */
export const RatingPair = z.object({
  plan: Floorplan,
  roomId: z.string().min(1),
  /** Shown on the left. */
  a: RoomVersion,
  /** Shown on the right. */
  b: RoomVersion,
});
export type RatingPair = z.infer<typeof RatingPair>;

/** GET /admin/ratings/next: null once every pair has been rated. */
export const NextPair = z.object({ pair: RatingPair.nullable() });
export type NextPair = z.infer<typeof NextPair>;

/** A room's score, and the features it's made of. */
export const RoomScore = z.object({
  score: z.number(),
  breakdown: z.record(z.string(), z.number()),
});
export type RoomScore = z.infer<typeof RoomScore>;

/** A rating saved, with what the scorer would have picked, shown once the rater has. */
export const RatingSaved = z.object({
  rating: Rating,
  scorer: z.object({ a: RoomScore, b: RoomScore, pick: RatingWinner }),
});
export type RatingSaved = z.infer<typeof RatingSaved>;

/** How the rating is going. */
export const RatingSummary = z.object({
  /** Active ratings. */
  rated: z.number().int().nonnegative(),
  /** Of them, those with a winner, and those where the scorer would have picked it too. */
  decided: z.number().int().nonnegative(),
  scorerAgrees: z.number().int().nonnegative(),
  /** Of those with a winner, how many were on the left: about half, unless one side draws. */
  leftWins: z.number().int().nonnegative(),
  /** Rooms in the pool, and how many have a rating. */
  rooms: z.number().int().nonnegative(),
  roomsRated: z.number().int().nonnegative(),
  /** The blind check of other weights against the current ones, when asked about (M7). */
  compare: z
    .object({
      /** The other weights' name. */
      name: z.string(),
      /** Rooms both furnished from the same intent and seeds; those that came out the same. */
      rooms: z.number().int().nonnegative(),
      same: z.number().int().nonnegative(),
      /** Of the rest, those rated, and whose room was picked: the other weights', or current. */
      rated: z.number().int().nonnegative(),
      wins: z.number().int().nonnegative(),
      losses: z.number().int().nonnegative(),
      ties: z.number().int().nonnegative(),
    })
    .optional(),
});
export type RatingSummary = z.infer<typeof RatingSummary>;

/** "Tell it" (M7): what should change in one room of a layout, in the rater's words. */
export const ReviseInput = z.object({
  layoutId: z.uuid(),
  roomId: z.string().min(1),
  words: z.string().trim().min(1).max(1000),
});
export type ReviseInput = z.infer<typeof ReviseInput>;

/** The room revised, as a new layout, and what of the words it couldn't do. */
export const Revised = z.object({
  room: RoomVersion,
  cannot: z.string().nullable(),
});
export type Revised = z.infer<typeof Revised>;
