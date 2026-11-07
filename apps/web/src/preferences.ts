import type { StylePreset } from '@roomie/schema';

// What "Your preferences" offers (docs/frontend-design.md §4.4): a budget with three named
// anchors that scale with the rooms chosen, and the styles as people pick them. Start values per
// furnished room, to tune once real layouts exist.

export type Tier = 'Essentials' | 'Comfortable' | 'Generous';

const PER_ROOM: Record<Tier, number> = { Essentials: 600, Comfortable: 1200, Generous: 2500 };

const LINES: Record<Tier, string> = {
  Essentials: 'Covers the basics in every room, mostly simpler pieces.',
  Comfortable: 'A full set for every room, with a few nicer pieces where you sit and sleep.',
  Generous: 'Room for larger sofas, solid wood and extras like rugs and lamps.',
};

/** The three anchors' amounts for this many rooms. */
export function anchors(rooms: number): Record<Tier, number> {
  const n = Math.max(rooms, 1);
  return {
    Essentials: PER_ROOM.Essentials * n,
    Comfortable: PER_ROOM.Comfortable * n,
    Generous: PER_ROOM.Generous * n,
  };
}

/** The budget a home starts with: Comfortable. */
export const defaultBudget = (rooms: number) => anchors(rooms).Comfortable;

/** Which anchor an amount is nearest, and what it buys in practice. */
export function tierOf(budget: number, rooms: number): { tier: Tier; line: string } {
  const a = anchors(rooms);
  const tier: Tier =
    budget < (a.Essentials + a.Comfortable) / 2
      ? 'Essentials'
      : budget < (a.Comfortable + a.Generous) / 2
        ? 'Comfortable'
        : 'Generous';
  return { tier, line: LINES[tier] };
}

/**
 * Whether the budget looks small for what was asked: under the basics for these rooms, or at the
 * basics with more than a couple of must-haves a room. A warning only, never a block.
 */
export function isTight(budget: number, rooms: number, mustHaves: number): boolean {
  const a = anchors(rooms);
  return budget < a.Essentials || (budget < a.Comfortable && mustHaves > 2 * Math.max(rooms, 1));
}

/** A style as a card: its title and one line (§4.4). */
export const STYLE_CARDS: Record<StylePreset, { title: string; line: string }> = {
  scandinavian: { title: 'Light & natural', line: 'Pale wood, white, soft textiles' },
  modern: { title: 'Clean & modern', line: 'Simple shapes, darker tones, little clutter' },
  warm_minimal: { title: 'Warm & simple', line: 'Few pieces, warm wood and earthy colours' },
};
