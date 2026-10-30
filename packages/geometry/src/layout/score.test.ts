import { Floorplan, LayoutIntent, Product, type Relation } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import catalog from '../../../../fixtures/catalog/products.json';
import intentJson from '../../../../fixtures/plans/00-demo-1br/intent.json';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import weights from '../../weights.json';
import { roomContext } from './room';
import { type Piece, relationScore, scoreFurniture, scoreHome, scoreRoom } from './score';
import { solveRoom } from './solve';
import { styleMatch } from './style';

const plan = Floorplan.parse(demo);
const intent = LayoutIntent.parse(intentJson);
const products = new Map(
  Product.array()
    .parse(catalog)
    .map((p) => [p.articleNo, p]),
);
const bedroom = roomContext(plan, 'r1')!;
const living = roomContext(plan, 'r2')!;
const Q = Math.PI / 2;

/** A piece of the fixture intent's room, by its ref, standing at x, y. */
function piece(roomId: string, ref: string, x: number, y: number, rotation = 0): Piece {
  const item = intent.rooms.find((r) => r.roomId === roomId)!.items.find((i) => i.ref === ref)!;
  return { ref, placement: { x, y, rotation }, product: products.get(item.articleNo)! };
}
const byRef = (...pieces: Piece[]) => new Map(pieces.map((p) => [p.ref, p]));
const score = (relation: Relation, ctx: typeof bedroom, ...pieces: Piece[]) =>
  relationScore(relation, byRef(...pieces), ctx);

// The furnished demo home of validate.test.ts.
const bed = piece('r1', 'bed', 2.3, 1.65);
const nsLeft = piece('r1', 'ns_left', 3.4, 0.8);
const nsRight = piece('r1', 'ns_right', 1.2, 0.8);
const wardrobe = piece('r1', 'wardrobe', 0.9, 3.2, Q);
const sofa = piece('r2', 'sofa', 4.51, 1.8, Q);
const coffee = piece('r2', 'coffee', 5.6, 1.8, Q);
const tv = piece('r2', 'tv', 8.2, 1.8, -Q);
const armchair = piece('r2', 'armchair', 7.0, 3.6, 2 * Q);
const rug = piece('r2', 'rug', 5.4, 1.8, Q);
const lamp = piece('r2', 'lamp', 8.25, 0.75);

describe('relationScore', () => {
  it('scores a back against the wall asked for', () => {
    const relation = { kind: 'against_wall', item: 'bed', wall: 'longest_windowless' } as const;
    // The north wall has the window; the west wall is as long and has none.
    expect(score(relation, bedroom, bed)).toBeCloseTo(0.5);
    expect(
      score(relation, bedroom, { ...bed, placement: { x: 1.65, y: 2, rotation: Q } }),
    ).toBeCloseTo(1);
    expect(score({ ...relation, wall: 'any' }, bedroom, bed)).toBeCloseTo(1);
    expect(score(relation, bedroom, { ...bed, placement: { x: 2.3, y: 2, rotation: 0 } })).toBe(0);
  });

  it('scores facing another item, the window or the middle of the room', () => {
    const relation = { kind: 'facing', item: 'tv', target: 'sofa' } as const;
    expect(score(relation, living, tv, sofa)).toBeCloseTo(1);
    expect(
      score(relation, living, { ...tv, placement: { ...tv.placement, rotation: Q } }, sofa),
    ).toBe(0);
    // The TV's nearest window is behind it; the sofa's is ahead and to its left.
    expect(score({ ...relation, target: 'window' }, living, tv, sofa)).toBe(0);
    // Turned 37° from the window: full marks end at 15°, none from 75°.
    const window = { kind: 'facing', item: 'sofa', target: 'window' } as const;
    const off = (Math.atan2(1.3, 1.74) * 180) / Math.PI;
    expect(score(window, living, tv, sofa)).toBeCloseTo(1 - (off - 15) / 60);
    expect(score({ ...relation, target: 'nothing' }, living, tv, sofa)).toBeUndefined();
  });

  it('scores a coffee table in front of a sofa by the legroom left', () => {
    const relation = {
      kind: 'in_front_of',
      item: 'coffee',
      target: 'sofa',
      distance: 'normal',
    } as const;
    expect(score(relation, living, coffee, sofa)).toBeCloseTo(1);
    const tight = { ...coffee, placement: { ...coffee.placement, x: 5.3 } };
    expect(score(relation, living, tight, sofa)).toBeCloseTo(1 - 0.26 / 0.5);
    const behind = { ...coffee, placement: { ...coffee.placement, x: 3.5 } };
    expect(score(relation, living, behind, sofa)).toBe(0);
  });

  it("scores a nightstand on the side asked for, at the bed's head", () => {
    const relation = { kind: 'beside', item: 'ns_left', target: 'bed', side: 'left' } as const;
    // The bed faces down the plan, so its left is to the right as drawn.
    expect(score(relation, bedroom, nsLeft, bed)).toBe(1);
    expect(score(relation, bedroom, { ...nsLeft, placement: nsRight.placement }, bed)).toBe(0);
    const foot = { ...nsLeft, placement: { ...nsLeft.placement, y: 2.4 } };
    expect(score(relation, bedroom, foot, bed)).toBeLessThan(0.1);
  });

  it('scores a pair mirrored about the bed', () => {
    const relation = { kind: 'pair', first: 'ns_left', second: 'ns_right', about: 'bed' } as const;
    expect(score(relation, bedroom, nsLeft, nsRight, bed)).toBeCloseTo(1);
    const off = { ...nsRight, placement: { ...nsRight.placement, y: 1.05 } };
    expect(score(relation, bedroom, nsLeft, off, bed)).toBeCloseTo(0.5);
  });

  it('scores a rug under its items, a sofa with its front legs on it', () => {
    const relation: Relation = { kind: 'under', item: 'rug', targets: ['sofa', 'coffee'] };
    expect(score(relation, living, rug, sofa, coffee)).toBeCloseTo((0.7 + 1) / 2);
  });

  it('scores a corner, a window nearby and a door far off', () => {
    expect(score({ kind: 'in_corner', item: 'lamp' }, living, lamp)).toBe(1);
    expect(score({ kind: 'in_corner', item: 'coffee' }, living, coffee)).toBe(0);
    const desk = { ...coffee, ref: 'desk', placement: { x: 6.25, y: 1.0, rotation: 0 } };
    expect(score({ kind: 'near_window', item: 'desk' }, living, desk)).toBe(1);
    expect(score({ kind: 'away_from_door', item: 'bed' }, bedroom, bed)).toBeCloseTo(
      (Math.hypot(1.7, 1.75) - 1) / 2,
    );
  });

  it('scores chairs around a table, close and facing it', () => {
    const table = {
      ...coffee,
      ref: 'table',
      product: { ...coffee.product, dims: { w: 1.2, d: 0.8, h: 0.75 } },
    };
    const at = { ...table, placement: { x: 6, y: 2.5, rotation: 0 } };
    const chair = { ...coffee, ref: 'chair', placement: { x: 6, y: 3.0, rotation: 2 * Q } };
    const relation: Relation = { kind: 'around', items: ['chair'], target: 'table' };
    expect(score(relation, living, at, chair)).toBeCloseTo(1);
    const away = { ...chair, placement: { ...chair.placement, rotation: 0 } };
    expect(score(relation, living, at, away)).toBe(0);
  });
});

describe('scoreRoom', () => {
  const relations = intent.rooms.find((r) => r.roomId === 'r2')!.relations;
  const furnished = [sofa, coffee, tv, armchair, rug, lamp];

  it('weighs the features that apply by weights.json', () => {
    const { score, breakdown } = scoreRoom(living, furnished, { relations });
    expect(Object.keys(breakdown).sort()).toEqual(
      ['focal', 'relations', 'spread', 'tv_view', 'walkway', 'walls', 'windows'].sort(),
    );
    const w = weights.room as Record<string, number>;
    const total = Object.keys(breakdown).reduce((s, k) => s + w[k]!, 0);
    const sum = Object.entries(breakdown).reduce((s, [k, v]) => s + w[k]! * v, 0);
    expect(score).toBeCloseTo(sum / total);
    expect(breakdown.walls).toBeCloseTo(1);
    expect(breakdown.focal).toBeGreaterThan(0.9);
    expect(breakdown.tv_view).toBeCloseTo(1);
  });

  it('wants the TV square to the sofa, centered on it, at a distance to watch', () => {
    const view = (t: Piece, s: Piece = sofa) =>
      scoreRoom(living, [s, t], { walkway: false }).breakdown.tv_view!;
    expect(view(tv)).toBeCloseTo(1);
    // On the side wall, turned 90° from the sofa.
    expect(view({ ...tv, placement: { x: 6.2, y: 0.25, rotation: 0 } })).toBe(0);
    // Facing the sofa but 1.2 m off its middle, or the sofa across the room, 7 m away.
    const aside = view({ ...tv, placement: { x: 8.2, y: 3.0, rotation: -Q } });
    expect(aside).toBeGreaterThan(0);
    expect(aside).toBeLessThan(0.3);
    expect(view(tv, { ...sofa, placement: { x: 1.2, y: 1.8, rotation: Q } })).toBe(0);
  });

  it('scores a sofa adrift in the room, turned from the TV, below one against the wall', () => {
    const adrift = { ...sofa, placement: { x: 6.5, y: 3.6, rotation: 0 } };
    const good = scoreRoom(living, furnished, { relations }).score;
    const worse = scoreRoom(living, [adrift, coffee, tv, armchair, rug, lamp], { relations }).score;
    expect(worse).toBeLessThan(good - 0.1);
  });

  it('marks a bed with its head under a window down', () => {
    const north = scoreRoom(bedroom, [bed]).breakdown.bed_head!;
    const west = scoreRoom(bedroom, [{ ...bed, placement: { x: 1.65, y: 2, rotation: Q } }])
      .breakdown.bed_head!;
    expect(north).toBeCloseTo(0.6);
    expect(west).toBeCloseTo(1);
  });

  it('leaves out the walkway while searching', () => {
    expect(scoreRoom(living, furnished, { walkway: false }).breakdown).not.toHaveProperty(
      'walkway',
    );
  });
});

describe('scoreHome', () => {
  const room = (roomId: string, area: number, score: number, pieces: Piece[]) => ({
    roomId,
    area,
    score,
    products: pieces.map((p) => p.product),
  });

  it('weighs rooms by area, and scores budget, style and consistency', () => {
    const rooms = [
      room('r1', 10, 0.8, [bed, nsLeft, wardrobe]),
      room('r2', 20, 0.5, [sofa, coffee]),
    ];
    const { breakdown } = scoreHome({ rooms, style: 'scandinavian', budgetCad: 2500 });
    expect(breakdown.rooms).toBeCloseTo((0.8 * 10 + 0.5 * 20) / 30);
    // $399 + $79 + $299 + $899 + $79 = $1,755 of $2,500: 70% used.
    expect(breakdown.budget).toBe(1);
    expect(breakdown.style_match).toBeGreaterThan(0.6);
    expect(breakdown.style_consistency).toBeGreaterThan(0);
    expect(scoreHome({ rooms, budgetCad: 1500 }).breakdown.budget).toBe(0);
  });
});

describe('scoreFurniture', () => {
  // The demo home as the solver furnishes it, each item keeping its ref, as the pipeline does.
  const solved = intent.rooms.map((room) => solveRoom(plan, room, products, { seed: 1 }));
  const furniture = solved
    .flatMap((r) => r.placements)
    .map((p, i) => ({ ...p, id: `f${i + 1}`, ref: p.id }));
  const options = { intents: intent.rooms, style: 'scandinavian' as const, budgetCad: 2800 };

  it('scores each room as the solver did, then the home', () => {
    const scores = scoreFurniture(plan, furniture, products, options);
    for (const room of solved) {
      expect(scores.rooms.get(room.roomId)!.score).toBeCloseTo(room.score, 6);
    }
    expect(Object.keys(scores.home.breakdown).sort()).toEqual(
      ['budget', 'rooms', 'style_consistency', 'style_match'].sort(),
    );
  });

  it('scores an edit that breaks a relation lower', () => {
    // The sofa turned to face the wall it stood against, away from the TV.
    const turned = furniture.map((f) =>
      f.ref === 'sofa' ? { ...f, rotation: f.rotation + Math.PI } : f,
    );
    const before = scoreFurniture(plan, furniture, products, options).rooms.get('r2')!;
    const after = scoreFurniture(plan, turned, products, options).rooms.get('r2')!;
    expect(after.breakdown.relations).toBeLessThan(before.breakdown.relations!);
    expect(after.score).toBeLessThan(before.score);
  });

  it('scores items placed by hand without relations, and leaves out empty rooms', () => {
    const byHand = furniture
      .filter((f) => f.roomId === 'r2')
      .map((f) => ({ ...f, ref: undefined }));
    const scores = scoreFurniture(plan, byHand, products, options);
    expect([...scores.rooms.keys()]).toEqual(['r2']);
    expect(scores.rooms.get('r2')!.breakdown).not.toHaveProperty('relations');
    expect(scores.rooms.get('r2')!.breakdown).toHaveProperty('walls');
  });
});

describe('styleMatch', () => {
  it('scores the colours and materials a style likes', () => {
    const white = { color: 'white', material: 'Solid wood' };
    expect(styleMatch(white, 'scandinavian')).toBe(1);
    expect(styleMatch(white, 'modern')).toBe(0.5);
    expect(styleMatch({ color: null, material: null }, 'modern')).toBe(0.5);
  });
});
