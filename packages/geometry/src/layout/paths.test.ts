import { describe, expect, it } from 'vitest';
import { walkways } from './paths';

const P = (x: number, y: number) => ({ x, y });
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  P(x0, y0),
  P(x1, y0),
  P(x1, y1),
  P(x0, y1),
];

// A 4 × 3 m room, a doorway's clear zone at each end, and a sofa's legroom by the right end.
const floor = rect(0, 0, 4, 3);
const entrances = [
  { id: 'left', region: rect(0, 1, 0.6, 2) },
  { id: 'right', region: rect(3.4, 1, 4, 2) },
];
const legroom = { id: 'sofa', parts: [rect(3, 0, 3.5, 0.35)] };

describe('walkways', () => {
  it('joins the ways in, and reaches what needs reaching, through an empty room', () => {
    expect(walkways(floor, [], [], entrances, [legroom])).toEqual({ cutOff: [], unreached: [] });
  });

  it('lets a path through a gap 80 cm wide, but not one 70 cm wide', () => {
    // A wall of furniture across the middle, from the top.
    expect(walkways(floor, [], [rect(1.9, 0, 2.1, 2.2)], entrances, []).cutOff).toEqual([]);
    expect(walkways(floor, [], [rect(1.9, 0, 2.1, 2.3)], entrances, []).cutOff).toEqual(['right']);
  });

  it('keeps the side joining the most ways in as the main walkway', () => {
    const three = [...entrances, { id: 'top', region: rect(1, 0, 2, 0.6) }];
    const across = [rect(2.5, 0, 2.7, 3)];
    expect(walkways(floor, [], across, three, [legroom])).toEqual({
      cutOff: ['right'],
      unreached: ['sofa'],
    });
  });

  it('lets a path widen past a side open to the next room', () => {
    // Furniture 60 cm off the bottom side: too narrow, unless the side is open.
    const blockers = [rect(1.9, 0, 2.1, 2.4)];
    expect(walkways(floor, [], blockers, entrances, []).cutOff).toEqual(['right']);
    const open = [rect(0, 3, 4, 3.6)];
    expect(walkways(floor, open, blockers, entrances, []).cutOff).toEqual([]);
  });
});
