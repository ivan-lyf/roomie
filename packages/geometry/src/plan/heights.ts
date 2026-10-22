import type { OpeningKind } from '@roomie/schema';

// Plans almost never show heights, so these are defaults the user can change (PLAN.md §5.1).

/** The most common ceiling height in Canadian apartments (8 ft). */
export const DEFAULT_CEILING_HEIGHT = 2.44;
/** A standard interior or entry door (80 in). */
export const DEFAULT_DOOR_HEIGHT = 2.03;
export const DEFAULT_SILL_HEIGHT = 0.9;
/** Windows end this far below the ceiling. */
export const WINDOW_HEAD_GAP = 0.3;

/** Default height (and sill, for windows) of a new opening under a given ceiling. */
export function defaultOpeningHeight(
  kind: OpeningKind,
  ceiling: number,
): { height: number; sillHeight?: number } {
  if (kind !== 'window') return { height: Math.min(DEFAULT_DOOR_HEIGHT, ceiling) };
  const sillHeight = Math.min(DEFAULT_SILL_HEIGHT, ceiling / 2);
  return { height: Math.max(ceiling - WINDOW_HEAD_GAP - sillHeight, 0.1), sillHeight };
}
