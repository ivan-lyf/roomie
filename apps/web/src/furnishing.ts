import {
  type FurnitureScores,
  type LayoutProblem,
  scoreFurniture,
  snapPlacement,
  turn,
  validateLayout,
} from '@roomie/geometry';
import type { Floorplan, HomeFurnishing, Placement, Product, RoomIntent } from '@roomie/schema';
import { useMemo } from 'react';
import { useFloorplan } from './stores/floorplan';
import { type Preview, useFurnish } from './stores/furnish';
import { useIntents } from './stores/intents';
import { useProducts } from './stores/products';

// Furnishing by hand: what the layout looks like mid-drag, what's wrong with it, and the edits
// that keys and buttons make to the selected item.

/** The id of a product shown where it would be placed, before it is. */
export const PREVIEW_ID = 'preview';

/**
 * The furniture as it looks now: the item being dragged where it's being dragged, and a product
 * about to be placed where it would go.
 */
export function liveFurniture(
  furniture: readonly Placement[],
  armed: { articleNo: string } | undefined,
  preview: Preview | undefined,
): Placement[] {
  if (!preview) return [...furniture];
  if (preview.id) {
    const { id, x, y, rotation, roomId } = preview;
    return furniture.map((f) => (f.id === id ? { ...f, x, y, rotation, roomId } : f));
  }
  if (!armed) return [...furniture];
  const { x, y, rotation, roomId } = preview;
  return [...furniture, { id: PREVIEW_ID, articleNo: armed.articleNo, x, y, rotation, roomId }];
}

export type Problems = {
  all: LayoutProblem[];
  /** Each item's problems, by its id. */
  byItem: ReadonlyMap<string, LayoutProblem[]>;
};

/**
 * What's wrong with the furniture as it looks now, mid-drag included. Items whose product is
 * still loading aren't judged yet.
 */
export function useLayoutProblems(plan: Floorplan): Problems {
  const products = useProducts((s) => s.byArticle);
  const missing = useProducts((s) => s.missing);
  const armed = useFurnish((s) => s.armed);
  const preview = useFurnish((s) => s.preview);
  const { walls, openings, rooms, obstacles, furniture } = plan;
  return useMemo(() => {
    const shapes = { walls, openings, rooms, obstacles };
    const live = liveFurniture(furniture, armed, preview).filter(
      (f) => products.has(f.articleNo) || missing.has(f.articleNo),
    );
    const all = validateLayout(shapes, live, products);
    const byItem = new Map<string, LayoutProblem[]>();
    for (const problem of all) {
      for (const id of problem.ids) {
        if (live.some((f) => f.id === id)) byItem.set(id, [...(byItem.get(id) ?? []), problem]);
      }
    }
    return { all, byItem };
  }, [walls, openings, rooms, obstacles, furniture, armed, preview, products, missing]);
}

/**
 * How many problems each room has: those of the items standing in it, and its walkways'. A
 * problem between items in two rooms counts in both.
 */
export function problemsByRoom(
  problems: readonly LayoutProblem[],
  furniture: readonly Pick<Placement, 'id' | 'roomId'>[],
): ReadonlyMap<string, number> {
  const roomOf = new Map(furniture.map((f) => [f.id, f.roomId]));
  const counts = new Map<string, number>();
  for (const problem of problems) {
    const rooms = new Set(problem.ids.flatMap((id) => roomOf.get(id) ?? []));
    if (problem.roomId) rooms.add(problem.roomId);
    for (const roomId of rooms) counts.set(roomId, (counts.get(roomId) ?? 0) + 1);
  }
  return counts;
}

export type Scores = {
  now: FurnitureScores;
  /** Each room's score as it was last furnished, before the edits since. */
  furnished: ReadonlyMap<string, number>;
};

/**
 * How good the furniture is as saved, each room and the home, next to how good each room was
 * when it was furnished. Worked out when an edit lands, not while an item is dragged.
 */
export function useScores(plan: Floorplan): Scores {
  const products = useProducts((s) => s.byArticle);
  const furnishing = useIntents((s) => s.furnishing);
  const { walls, openings, rooms, obstacles, furniture } = plan;
  const options = useMemo(
    () => ({
      intents: furnishing?.rooms.map((r) => r.intent),
      style: furnishing?.style ?? undefined,
      budgetCad: furnishing?.budgetCad ?? undefined,
    }),
    [furnishing],
  );
  const furnished = useMemo(() => {
    const shapes = { walls, openings, rooms, obstacles };
    const scores = new Map<string, number>();
    for (const room of furnishing?.rooms ?? []) {
      const scored = scoreFurniture(shapes, room.placements, products, options);
      const score = scored.rooms.get(room.roomId)?.score;
      if (score !== undefined) scores.set(room.roomId, score);
    }
    return scores;
  }, [walls, openings, rooms, obstacles, furnishing, products, options]);
  const now = useMemo(
    () => scoreFurniture({ walls, openings, rooms, obstacles }, furniture, products, options),
    [walls, openings, rooms, obstacles, furniture, products, options],
  );
  return { now, furnished };
}

/**
 * Turns an item where it stands. Against a wall, it moves out to stay flush when it can do so at
 * the new turn; it never turns back to face the room.
 */
export function rotateItem(itemId: string, by: number) {
  const { plan, moveItem } = useFloorplan.getState();
  const item = plan?.furniture.find((f) => f.id === itemId);
  const product = item && useProducts.getState().byArticle.get(item.articleNo);
  if (!plan || !item || !product) return;
  const rotation = turn(item.rotation, by);
  const snapped = snapPlacement({ ...item, rotation }, product, plan);
  const kept = Math.abs(turn(snapped.rotation, -rotation)) < 1e-6;
  moveItem(itemId, kept ? { x: snapped.x, y: snapped.y, rotation } : { rotation });
}

/** Moves an item a little across the plan, without snapping. */
export function nudgeItem(itemId: string, dx: number, dy: number) {
  const { plan, moveItem } = useFloorplan.getState();
  const item = plan?.furniture.find((f) => f.id === itemId);
  if (item) moveItem(itemId, { x: item.x + dx, y: item.y + dy });
}

/** The intent a room was last furnished from, if it was furnished for the user. */
export function roomIntent(
  furnishing: HomeFurnishing | undefined,
  roomId: string,
): RoomIntent | undefined {
  return furnishing?.rooms.find((r) => r.roomId === roomId)?.intent;
}

/**
 * Why an item is where it is, in the intent's words: only while it's still the product the
 * intent chose, in the room it chose it for. Items placed by hand have no reason.
 */
export function whyOf(
  item: Pick<Placement, 'roomId' | 'articleNo' | 'ref'>,
  furnishing: HomeFurnishing | undefined,
): string | undefined {
  if (!item.ref) return undefined;
  const chosen = roomIntent(furnishing, item.roomId)?.items.find((i) => i.ref === item.ref);
  return chosen?.articleNo === item.articleNo ? chosen.why : undefined;
}

export function removeItem(itemId: string) {
  useFloorplan.getState().remove([itemId]);
  useFurnish.getState().select(undefined);
}

/** Takes everything out of a room, as one edit to undo. */
export function clearRoom(roomId: string) {
  const { plan, remove } = useFloorplan.getState();
  const ids = plan?.furniture.filter((f) => f.roomId === roomId).map((f) => f.id) ?? [];
  if (ids.length === 0) return;
  remove(ids);
  useFurnish.getState().select(undefined);
}

export type Totals = { count: number; priceCad: number };

/**
 * How many items the home has and what they cost, in all and per room. Prices are the catalog's,
 * from the last scrape; an item whose product hasn't loaded counts without a price.
 */
export function furnitureTotals(
  furniture: readonly Placement[],
  products: ReadonlyMap<string, Pick<Product, 'priceCad'>>,
): { home: Totals; byRoom: ReadonlyMap<string, Totals> } {
  const home = { count: 0, priceCad: 0 };
  const byRoom = new Map<string, Totals>();
  for (const item of furniture) {
    const price = products.get(item.articleNo)?.priceCad ?? 0;
    const room = byRoom.get(item.roomId) ?? { count: 0, priceCad: 0 };
    byRoom.set(item.roomId, { count: room.count + 1, priceCad: room.priceCad + price });
    home.count++;
    home.priceCad += price;
  }
  return { home, byRoom };
}
