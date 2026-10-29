import { bounds, floorPolygon, styleMatch } from '@roomie/geometry';
import {
  type Category,
  type Floorplan,
  type GenerationInputs,
  type Product,
  ROOM_CATEGORIES,
  type RoomType,
} from '@roomie/schema';

// What the LLM may choose from: the catalog is too big to send (about 2,900 products), so per
// category, the families that fit the rooms, sit in their share of the budget, and suit the
// style (PLAN.md M4).

/** How a room's share of the budget compares with others, before its size counts. */
const ROOM_WEIGHT: Partial<Record<RoomType, number>> = {
  living_room: 1,
  bedroom: 0.8,
  studio: 1.6,
  dining_area: 0.5,
  den_office: 0.6,
};

/** About what share of a room's budget one item of each category takes. */
const CATEGORY_SHARE: Record<Category, number> = {
  sofa: 0.45,
  bed: 0.4,
  wardrobe: 0.3,
  dining_table: 0.35,
  desk: 0.25,
  armchair: 0.2,
  tv_unit: 0.2,
  dresser: 0.2,
  shelving: 0.15,
  desk_chair: 0.15,
  coffee_table: 0.1,
  dining_chair: 0.08,
  nightstand: 0.08,
  rug: 0.1,
  floor_lamp: 0.06,
};

/** Families offered per category. */
const PER_CATEGORY = 10;
/** How far over its share an item's price may go and still be offered. */
const SLACK = 1.6;

/** A room's floor inside its walls, width by depth on the plan. */
export function floorSize(plan: Floorplan, roomId: string): { w: number; d: number } {
  const room = plan.rooms.find((r) => r.id === roomId)!;
  const { min, max } = bounds(floorPolygon(room.boundary, plan.walls));
  return { w: max.x - min.x, d: max.y - min.y };
}

/** The budget split between rooms by type and size: a starting point the LLM can change. */
export function splitBudget(plan: Floorplan, roomIds: readonly string[], budgetCad: number) {
  const weights = roomIds.map((id) => {
    const room = plan.rooms.find((r) => r.id === id)!;
    const { w, d } = floorSize(plan, id);
    return (ROOM_WEIGHT[room.roomType] ?? 0.5) * Math.sqrt(w * d);
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return new Map(roomIds.map((id, i) => [id, (budgetCad * weights[i]!) / total]));
}

export type Candidates = Map<Category, Product[]>;

/**
 * The products to offer per category: active, fitting the largest room that wants the category
 * (either way round), priced within its share of that room's budget, one variant per family
 * (the one suiting the style best, then the cheapest), the families suiting the style first.
 */
export function pickCandidates(
  plan: Floorplan,
  catalog: readonly Product[],
  inputs: GenerationInputs,
): Candidates {
  const budget = splitBudget(plan, inputs.roomIds, inputs.budgetCad);
  const wants = new Map<Category, { size: { w: number; d: number }; cap: number }>();
  for (const id of inputs.roomIds) {
    const room = plan.rooms.find((r) => r.id === id);
    if (!room) continue;
    const size = floorSize(plan, id);
    const categories = new Set([
      ...(ROOM_CATEGORIES[room.roomType] ?? []),
      ...(inputs.mustHaves[id] ?? []),
    ]);
    for (const c of categories) {
      const cap = budget.get(id)! * CATEGORY_SHARE[c] * SLACK;
      const have = wants.get(c);
      wants.set(c, {
        size: have && have.size.w * have.size.d > size.w * size.d ? have.size : size,
        cap: Math.max(cap, have?.cap ?? 0),
      });
    }
  }

  const out: Candidates = new Map();
  for (const [category, { size, cap }] of wants) {
    const fits = catalog.filter(
      (p) =>
        p.category === category &&
        p.status === 'active' &&
        ((p.dims.w <= size.w && p.dims.d <= size.d) || (p.dims.w <= size.d && p.dims.d <= size.w)),
    );
    // Always something to offer: if nothing is within the share, the cheapest few are.
    const prices = fits.map((p) => p.priceCad).sort((a, b) => a - b);
    const limit = Math.max(cap, prices[Math.min(PER_CATEGORY, prices.length) - 1] ?? 0);
    const families = new Map<string, Product>();
    const match = (p: Product) => styleMatch(p, inputs.style);
    for (const p of fits.filter((p) => p.priceCad <= limit)) {
      const kept = families.get(p.familyId);
      if (
        !kept ||
        match(p) > match(kept) ||
        (match(p) === match(kept) && p.priceCad < kept.priceCad)
      ) {
        families.set(p.familyId, p);
      }
    }
    const target = cap / SLACK;
    const ranked = [...families.values()].sort(
      (a, b) =>
        match(b) - match(a) ||
        Math.abs(a.priceCad - target) - Math.abs(b.priceCad - target) ||
        a.articleNo.localeCompare(b.articleNo),
    );
    out.set(category, ranked.slice(0, PER_CATEGORY));
  }
  return out;
}

const cm = (m: number) => Math.round(m * 100);

/** IKEA's name without the size it often repeats: "TARVA Nightstand - pine 48x39x62 cm (…)". */
export const shortName = (name: string) => name.replace(/\s+\d+(?:x\d+)+ cm.*$/, '');

/** The candidates as the LLM reads them: one line per product, under its category. */
export function candidatesText(candidates: Candidates): string {
  return [...candidates]
    .map(([category, products]) =>
      [
        `## ${category}`,
        ...products.map(
          (p) =>
            `- ${p.articleNo} | ${shortName(p.name)} | $${p.priceCad.toFixed(2)} | ` +
            `${cm(p.dims.w)} × ${cm(p.dims.d)} × ${cm(p.dims.h)} cm` +
            `${p.shape === 'round' ? ' round' : ''}` +
            ` | ${p.color ?? '?'} | ${p.material ?? '?'}`,
        ),
      ].join('\n'),
    )
    .join('\n\n');
}
