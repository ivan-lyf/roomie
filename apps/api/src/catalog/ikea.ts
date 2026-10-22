import { type Category, type Dims, Product } from '@roomie/schema';
import { z } from 'zod';

/** One line of data/ikea/items.jsonl, as written by tools/scraper. */
export const IkeaItem = z.object({
  itemNo: z.string(),
  articleNo: z.string().nullable(),
  url: z.string(),
  name: z.string().nullable(),
  priceCad: z.number().nullable(),
  currency: z.string().nullable(),
  categoryPath: z.array(z.object({ id: z.string(), name: z.string() })),
  measurements: z.array(
    z.object({
      name: z.string().nullable(),
      text: z.string(),
      minM: z.number().nullable(),
      maxM: z.number().nullable(),
    }),
  ),
  imageUrl: z.string().nullable(),
  modelUrl: z.string().nullable(),
  scrapedAt: z.string(),
});
export type IkeaItem = z.infer<typeof IkeaItem>;

type CategoryRule = {
  /** IKEA category ids, from category page URLs (ikea.com/ca/en/cat/sofas-fu003/). */
  ikeaCategories: string[];
  /** Measurement names to read each dimension from, in order of preference. */
  dims: Record<keyof Dims, string[]>;
};

// M0 maps sofas only; M1 adds the other MVP categories.
const CATEGORY_RULES: [Category, CategoryRule][] = [
  [
    'sofa',
    {
      ikeaCategories: ['fu003'],
      dims: {
        w: ['Width'],
        d: ['Depth'],
        // Overall heights only: "Backrest height" can sit below the back cushions.
        h: ['Height', 'Height including back cushions'],
      },
    },
  ],
];

export type ImportResult = { ok: true; product: Product } | { ok: false; reason: string };

/**
 * Map a scraped IKEA item to a catalog product. Returns undefined for items
 * outside the mapped categories.
 */
export function toProduct(item: IkeaItem, hasModel: boolean): ImportResult | undefined {
  const ids = new Set(item.categoryPath.map((c) => c.id));
  const match = CATEGORY_RULES.find(([, rule]) => rule.ikeaCategories.some((id) => ids.has(id)));
  if (!match) return undefined;
  const [category, rule] = match;

  if (item.currency !== 'CAD') {
    return { ok: false, reason: `price not in CAD (${item.currency ?? 'missing'})` };
  }
  const dims: Partial<Dims> = {};
  for (const key of ['w', 'd', 'h'] as const) {
    const names = rule.dims[key];
    // Use the largest extent of a range: dims are a bounding box.
    const value = names
      .map((name) => item.measurements.find((m) => m.name === name)?.maxM)
      .find((v) => v != null);
    if (value == null) return { ok: false, reason: `no ${names.join(' or ')}` };
    dims[key] = value;
  }

  const parsed = Product.safeParse({
    articleNo: item.articleNo,
    name: item.name,
    category,
    priceCad: item.priceCad,
    url: item.url,
    imageUrl: item.imageUrl,
    dims,
    shape: 'rect',
    extendedW: null,
    modelUrl: null,
    modelSource: hasModel ? 'ikea' : 'procedural',
    styleTags: [],
    scrapedAt: item.scrapedAt,
  });
  return parsed.success
    ? { ok: true, product: parsed.data }
    : { ok: false, reason: z.prettifyError(parsed.error) };
}

/** IKEA item numbers are article numbers without the dots: 594.424.83 -> 59442483. */
export function itemNoOf(product: Pick<Product, 'articleNo'>): string {
  return product.articleNo.replaceAll('.', '');
}
