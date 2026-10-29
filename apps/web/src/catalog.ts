import type { Product } from '@roomie/schema';

export type Family = { id: string; name: string; variants: Product[] };
export type OptionChoice = { name: string; values: string[] };

/** IKEA's name for the design: "MALM Bed frame, high - white Queen" -> "MALM Bed frame, high". */
export function familyName(product: Product): string {
  return product.name.split(' - ')[0] ?? product.name;
}

/** Products grouped by family: families by name, variants by price. */
export function groupFamilies(products: readonly Product[]): Family[] {
  const byId = new Map<string, Product[]>();
  for (const product of products) {
    byId.set(product.familyId, [...(byId.get(product.familyId) ?? []), product]);
  }
  return [...byId]
    .map(([id, variants]) => ({
      id,
      name: familyName(variants[0]!),
      variants: variants.toSorted(
        (a, b) => a.priceCad - b.priceCad || a.articleNo.localeCompare(b.articleNo),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The options a family's variants differ by, in IKEA's order, with every value they take. */
export function optionChoices(variants: readonly Product[]): OptionChoice[] {
  const values = new Map<string, string[]>();
  for (const variant of variants) {
    for (const { name, value } of variant.options) {
      const seen = values.get(name) ?? [];
      if (!seen.includes(value)) values.set(name, [...seen, value]);
    }
  }
  return [...values]
    .filter(([, vs]) => vs.length > 1)
    .map(([name, vs]) => ({ name, values: vs }));
}

/** The variant with option `name` set to `value` that keeps most of `current`'s other options. */
export function pickVariant(
  variants: readonly Product[],
  current: Product,
  name: string,
  value: string,
): Product | undefined {
  const others = new Map(current.options.filter((o) => o.name !== name).map((o) => [o.name, o.value]));
  let best: Product | undefined;
  let bestShared = -1;
  for (const variant of variants) {
    if (!variant.options.some((o) => o.name === name && o.value === value)) continue;
    const shared = variant.options.filter((o) => others.get(o.name) === o.value).length;
    if (shared > bestShared) {
      best = variant;
      bestShared = shared;
    }
  }
  return best;
}

/** What to show when furnishing. Sizes in meters; a limit left out is no limit. */
export type ProductFilter = {
  maxPrice?: number;
  maxWidth?: number;
  maxDepth?: number;
  /** The room's floor, width by depth: hides products that fit it neither way round. */
  room?: { w: number; d: number };
};

export function matchesFilter(product: Product, filter: ProductFilter): boolean {
  const { w, d } = product.dims;
  if (filter.maxPrice !== undefined && product.priceCad > filter.maxPrice) return false;
  if (filter.maxWidth !== undefined && w > filter.maxWidth) return false;
  if (filter.maxDepth !== undefined && d > filter.maxDepth) return false;
  if (filter.room) {
    const { w: across, d: down } = filter.room;
    if (!((w <= across && d <= down) || (w <= down && d <= across))) return false;
  }
  return true;
}
