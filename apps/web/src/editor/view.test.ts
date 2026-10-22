import { describe, expect, it } from 'vitest';
import { fitView, toPixels, zoomAt } from './view';

describe('view', () => {
  it('fits a drawing into the viewport, centered', () => {
    expect(fitView({ width: 1000, height: 500 }, { width: 548, height: 548 })).toEqual({
      zoom: 0.5,
      x: 24,
      y: 149,
    });
  });

  it('zooms about the cursor', () => {
    const view = { x: 10, y: 20, zoom: 1 };
    const cursor = { x: 110, y: 220 };
    const zoomed = zoomAt(view, cursor, 2);
    expect(zoomed.zoom).toBe(2);
    expect(toPixels(zoomed, cursor)).toEqual(toPixels(view, cursor));
  });
});
