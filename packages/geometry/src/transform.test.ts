import { describe, expect, it } from 'vitest';
import { footprint, frontDirection, localToPlan } from './index';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('frontDirection', () => {
  it('faces +y at rotation 0', () => close(frontDirection(0), { x: 0, y: 1 }));
  it('faces +x at rotation π/2', () => close(frontDirection(Math.PI / 2), { x: 1, y: 0 }));
});

describe('localToPlan', () => {
  it('translates without rotation', () => {
    close(localToPlan({ x: 1, y: 2 }, { x: 3, y: 4 }, 0), { x: 4, y: 6 });
  });

  it('sends local front (+y) along frontDirection', () => {
    const r = 0.7;
    close(localToPlan({ x: 0, y: 1 }, { x: 0, y: 0 }, r), frontDirection(r));
  });

  it('matches a Three.js rotation.y of the same angle', () => {
    // Three.js rotation about +Y maps (x, z) to (x cos r + z sin r, -x sin r + z cos r).
    const r = 1.1;
    const [x, z] = [0.4, -0.3];
    close(localToPlan({ x, y: z }, { x: 0, y: 0 }, r), {
      x: x * Math.cos(r) + z * Math.sin(r),
      y: -x * Math.sin(r) + z * Math.cos(r),
    });
  });
});

describe('footprint', () => {
  it('is axis-aligned and sized by w×d at rotation 0', () => {
    const [bl, br, fr, fl] = footprint({ x: 0, y: 0 }, { w: 2, d: 1, h: 0.8 }, 0);
    close(bl, { x: -1, y: -0.5 });
    close(br, { x: 1, y: -0.5 });
    close(fr, { x: 1, y: 0.5 });
    close(fl, { x: -1, y: 0.5 });
  });

  it('swaps extents at rotation π/2', () => {
    const pts = footprint({ x: 0, y: 0 }, { w: 2, d: 1, h: 0.8 }, Math.PI / 2);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2, 9);
  });
});
