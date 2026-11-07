import { describe, expect, it } from 'vitest';
import { anchors, defaultBudget, isTight, tierOf } from './preferences';

describe('the budget', () => {
  it('scales its anchors with the rooms chosen', () => {
    expect(anchors(1)).toEqual({ Essentials: 600, Comfortable: 1200, Generous: 2500 });
    expect(anchors(3)).toEqual({ Essentials: 1800, Comfortable: 3600, Generous: 7500 });
    expect(anchors(0)).toEqual(anchors(1));
    expect(defaultBudget(2)).toBe(2400);
  });

  it('names the nearest anchor and what it buys', () => {
    expect(tierOf(700, 1).tier).toBe('Essentials');
    expect(tierOf(1200, 1).tier).toBe('Comfortable');
    expect(tierOf(2000, 1).tier).toBe('Generous');
    expect(tierOf(2000, 1).line).toMatch(/rugs and lamps/);
  });

  it('warns when it looks tight for what was asked', () => {
    expect(isTight(500, 1, 0)).toBe(true);
    expect(isTight(700, 1, 3)).toBe(true);
    expect(isTight(700, 1, 1)).toBe(false);
    expect(isTight(3600, 3, 9)).toBe(false);
  });
});
