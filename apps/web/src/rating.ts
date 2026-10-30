import type {
  ItemNote,
  NoteProblem,
  Product,
  RatingSummary,
  RoomProblem,
  RoomScore,
  Side,
} from '@roomie/schema';
import { formatPrice } from './format';

// The rating page's words and small decisions (PLAN.md M7), apart from the page.

/** What each scorer feature measures, in plain words. */
export const FEATURES: Record<string, string> = {
  relations: 'Pieces where the intent put them, relative to each other',
  walls: 'Backs against walls',
  focal: 'Seats facing the TV or table',
  tv_view: 'TV seen well from the sofa',
  armchairs: 'Armchair with the sofa, or by a lamp or window',
  walkway: 'Room to walk through',
  bed_head: 'Bed head against a wall',
  desk_window: 'Desk by a window',
  windows: 'Windows left clear',
  spread: 'Pieces spread through the room',
};

/** The room-wide problems, as the toggles say them. */
export const ROOM_PROBLEMS: Record<RoomProblem, string> = {
  too_full: 'Too full',
  too_empty: 'Too empty',
  hard_to_walk_through: 'Hard to walk through',
  blocks_a_window: 'Blocks a window',
  needs_more_seating: 'Needs more seating',
  pieces_dont_go_together: "Pieces don't go together",
};

/** What a label says is wrong, in words: "B · the sofa is too far from the TV unit". */
export const NOTE_PROBLEMS: Record<NoteProblem, string> = {
  too_far_from: 'is too far from',
  too_close_to: 'is too close to',
  facing_away: 'faces the wrong way',
  blocks: 'is in the way',
  against_window: 'stands in front of a window',
  off_center: 'is off center',
  wrong_size: 'is the wrong size',
  missing: 'is missing',
  not_needed: "isn't needed",
  style: "doesn't go with the rest",
  other: 'has another problem',
};

/** Whether the rater wrote anything for the AI to read. */
export const written = (form: { note: string; itemNotes: readonly ItemNote[] }) =>
  form.note.trim() !== '' || form.itemNotes.some((n) => n.note.trim() !== '');

/** Differences smaller than this aren't worth showing. */
const NOTICEABLE = 0.02;

export type Difference = { feature: string; a: number; b: number };

/**
 * The features that differ most between the two rooms, the biggest difference first. Only those
 * both rooms have: one that applies to one room only (no TV, no desk) isn't a difference in how
 * well it's met.
 */
export function differences(a: RoomScore, b: RoomScore, count = 3): Difference[] {
  return Object.entries(a.breakdown)
    .flatMap(([feature, x]) => {
      const y = b.breakdown[feature];
      return y === undefined ? [] : [{ feature, a: x, b: y }];
    })
    .filter((d) => Math.abs(d.a - d.b) >= NOTICEABLE)
    .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b))
    .slice(0, count);
}

/** How the rating is going, in a line. */
export function tally(s: RatingSummary): string {
  const parts = [`${s.rated} rated`];
  if (s.decided > 0) {
    parts.push(`the scorer agrees on ${s.scorerAgrees} of ${s.decided} with a winner`);
    parts.push(`the left one won ${s.leftWins} of ${s.decided}`);
  }
  parts.push(`${s.roomsRated} of ${s.rooms} rooms rated`);
  const c = s.compare;
  if (c) {
    parts.push(
      `blind check of ${c.name}: picked in ${c.wins}, the current weights in ${c.losses}, ` +
        `about the same in ${c.ties}, of ${c.rated} rated; ${c.same} of ${c.rooms} rooms came ` +
        'out the same either way',
    );
  }
  return parts.join(' · ');
}

/** Flags an item on one side as standing in a bad spot, or unflags it. */
export function toggleItem(
  notes: readonly ItemNote[],
  side: Side,
  placementId: string,
): ItemNote[] {
  const flagged = notes.some((n) => n.side === side && n.placementId === placementId);
  return flagged
    ? notes.filter((n) => !(n.side === side && n.placementId === placementId))
    : [...notes, { side, placementId, note: '' }];
}

const cm = (meters: number) => Math.round(meters * 100);

/** A product as the page names it: its name and variant, its color, size and price. */
export function describeProduct(product: Product): string {
  const { w, d, h } = product.dims;
  const { name, color } = product;
  // The variant often names the color already: "… - white Queen".
  const colored = color && !name.toLowerCase().includes(color.toLowerCase()) ? color : undefined;
  return [name, colored, `${cm(w)} × ${cm(d)} × ${cm(h)} cm`, formatPrice(product.priceCad)]
    .filter(Boolean)
    .join(' · ');
}
