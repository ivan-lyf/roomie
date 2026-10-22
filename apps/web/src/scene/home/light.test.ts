import { describe, expect, it } from 'vitest';
import { kelvinToRgb, warmthLabel } from './light';

describe('kelvinToRgb', () => {
  it('makes warm bulbs orange and daylight almost white', () => {
    const [r, g, b] = kelvinToRgb(2700);
    expect(r).toBe(1);
    expect(g).toBeCloseTo(0.65, 1);
    expect(b).toBeCloseTo(0.34, 1);
    const day = kelvinToRgb(6500);
    for (const c of day) expect(c).toBeGreaterThan(0.95);
  });

  it('gets bluer as the temperature rises', () => {
    const blues = [2700, 3500, 4500, 5500, 6500].map((k) => kelvinToRgb(k)[2]);
    expect(blues).toEqual(blues.toSorted((a, b) => a - b));
  });

  it('names the warmth', () => {
    expect([2700, 4000, 6500].map(warmthLabel)).toEqual(['warm', 'neutral', 'daylight']);
  });
});
