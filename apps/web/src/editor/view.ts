import { bounds } from '@roomie/geometry';
import type { Floorplan, Vec2 } from '@roomie/schema';

/** How the plan sits on screen: a screen point is an image pixel times `zoom`, plus `x`, `y`. */
export type View = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 20;

/** The size of the drawing in image pixels: the image's, or the plan's extent with a margin. */
export function canvasSize(plan: Floorplan): { width: number; height: number } {
  if (plan.image) return { width: plan.image.width, height: plan.image.height };
  const mpp = plan.scale?.metersPerPixel ?? 0.01;
  const points = [
    ...plan.walls.flatMap((w) => [w.a, w.b]),
    ...plan.rooms.flatMap((r) => r.boundary),
  ];
  if (points.length === 0) return { width: 1000, height: 800 };
  const { max } = bounds(points);
  return { width: Math.ceil((max.x + 0.5) / mpp), height: Math.ceil((max.y + 0.5) / mpp) };
}

/** The view that fits a drawing in a viewport, centered, with a margin. */
export function fitView(
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 24,
): View {
  const zoom = Math.min(
    (viewport.width - 2 * margin) / size.width,
    (viewport.height - 2 * margin) / size.height,
  );
  const z = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
  return {
    zoom: z,
    x: (viewport.width - size.width * z) / 2,
    y: (viewport.height - size.height * z) / 2,
  };
}

/** Zooms by `factor` keeping the point under the cursor in place. */
export function zoomAt(view: View, screen: Vec2, factor: number): View {
  const zoom = Math.min(Math.max(view.zoom * factor, MIN_ZOOM), MAX_ZOOM);
  const k = zoom / view.zoom;
  return { zoom, x: screen.x - (screen.x - view.x) * k, y: screen.y - (screen.y - view.y) * k };
}

/** The image pixel under a screen point. */
export const toPixels = (view: View, screen: Vec2): Vec2 => ({
  x: (screen.x - view.x) / view.zoom,
  y: (screen.y - view.y) / view.zoom,
});
