import { type LayoutProblem, snapPlacement, turn, validateLayout } from '@roomie/geometry';
import type { Floorplan, Placement } from '@roomie/schema';
import { useMemo } from 'react';
import { useFloorplan } from './stores/floorplan';
import { type Preview, useFurnish } from './stores/furnish';
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

export function removeItem(itemId: string) {
  useFloorplan.getState().remove([itemId]);
  useFurnish.getState().select(undefined);
}
