import { type Category, type Dims, Product, type ProductShape } from '@roomie/schema';
import { z } from 'zod';

/** One line of data/ikea/items.jsonl, as written by tools/scraper. */
export const IkeaItem = z.object({
  itemNo: z.string(),
  articleNo: z.string().nullable(),
  url: z.string(),
  name: z.string().nullable(),
  /** Product type, then the variant: "Sofa, Blekinge white". */
  description: z.string().nullable(),
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
  /** What the page's color, size and option pickers say this variant is. */
  options: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  /** The other variants those pickers link to. */
  variantItemNos: z.array(z.string()).default([]),
  imageUrl: z.string().nullable(),
  color: z.string().nullable().default(null),
  material: z.string().nullable().default(null),
  modelUrl: z.string().nullable(),
  scrapedAt: z.string(),
});
export type IkeaItem = z.infer<typeof IkeaItem>;

type Size = { dims: Dims; shape: ProductShape; extendedW: number | null };

class MissingMeasurement extends Error {}

/** Reads an item's measurements by IKEA's names, in meters. */
function lengths(item: IkeaItem) {
  // Use the largest extent of a range: dims are a bounding box.
  const find = (name: string) => item.measurements.find((m) => m.name === name)?.maxM ?? undefined;
  const missing = (names: string[]) => new MissingMeasurement(`no ${names.join(' or ')}`);
  return {
    has: (name: string) => find(name) != null,
    optional: find,
    /** The first of `names` the item lists. */
    first(...names: string[]): number {
      for (const name of names) {
        const value = find(name);
        if (value != null) return value;
      }
      throw missing(names);
    },
    /** The largest of `names` the item lists. */
    largest(...names: string[]): number {
      const values = names.map(find).filter((v) => v != null);
      if (values.length === 0) throw missing(names);
      return Math.max(...values);
    },
  };
}
type Lengths = ReturnType<typeof lengths>;

const rect = (w: number, d: number, h: number, extendedW: number | null = null): Size => ({
  dims: { w, d, h },
  shape: 'rect',
  extendedW,
});

const round = (diameter: number, h: number, extendedW: number | null = null): Size => ({
  dims: { w: diameter, d: diameter, h },
  shape: 'round',
  extendedW,
});

/** Width across the front, depth, and the tallest of `heights`. */
const box = (l: Lengths, ...heights: string[]) =>
  rect(l.first('Width'), l.first('Depth'), l.largest(...heights));

/**
 * Tables list Length x Width (long side first) or Width x Depth, and round ones a Diameter.
 * Length is the everyday size; Min. and Max. length are folded and fully extended.
 */
function table(l: Lengths, h: number): Size {
  const extended = (w: number) => {
    const max = l.optional('Max. length');
    return max != null && max > w ? max : null;
  };
  if (l.has('Diameter') && !l.has('Length')) {
    const diameter = l.first('Diameter');
    return round(diameter, h, extended(diameter));
  }
  if (l.has('Length') || l.has('Min. length') || l.has('Max. length')) {
    const w = l.first('Length', 'Min. length', 'Max. length');
    return rect(w, l.first('Width', 'Max. width'), h, extended(w));
  }
  return rect(l.first('Width'), l.first('Depth'), h);
}

type CategoryRule = {
  /** IKEA category ids, from category page URLs (ikea.com/ca/en/cat/sofas-fu003/). */
  ikeaCategories: string[];
  /** Product types to leave out (parts, add-ons and sets), matched before the first comma. */
  skip?: RegExp;
  /** Product types to keep, for IKEA categories that mix in many other things. */
  only?: RegExp;
  /** `type` is the product type, e.g. "Daybed frame with 2 drawers". */
  size: (l: Lengths, type: string) => Size;
};

/**
 * Corner and chaise pieces, and KALLAX desk combinations (a desk across a shelf unit), need
 * L- or T-shaped footprints: a post-MVP goal (PLAN.md §8).
 */
const L_SHAPED = /corner|crnr|\bcrn\b|chaise|u-shaped|l-shaped|desk combination/i;
const L_SHAPED_MEASUREMENTS = ['Width left', 'Width right', 'Depth chaise'];

/** Most rugs list no thickness, and it only matters for rendering. */
const RUG_THICKNESS = 0.01;

/** Sit/stand desks at a standard desk height within their range, as IKEA models them. */
const DESK_HEIGHT = 0.74;

// Category ids and product types come from the full crawl of 2026-10-21.
const CATEGORY_RULES: [Category, CategoryRule][] = [
  [
    'bed',
    {
      ikeaCategories: ['bm003'],
      skip: /^(back cushion|trundle bed)$/i,
      size: (l, type) => {
        const h = l.largest(
          'Height',
          'Headboard height',
          'Max. headboard height',
          'Footboard height',
        );
        // Daybeds are sat on along their long side, like a sofa. Other beds face their foot
        // end, so their length is the depth.
        return /^day-?bed/i.test(type)
          ? rect(l.first('Length', 'Bed length'), l.first('Width'), h)
          : rect(l.first('Width', 'Bed width'), l.first('Length', 'Bed length'), h);
      },
    },
  ],
  [
    'sofa',
    {
      // Sofas, sectionals and sofa beds.
      ikeaCategories: ['fu003', '31786', '10663'],
      skip: /\bsection\b|module|armrest|frame for|mattress|cushion/i,
      // Overall heights only: "Backrest height" can sit below the back cushions.
      size: (l) => box(l, 'Height', 'Height including back cushions'),
    },
  ],
  [
    'armchair',
    {
      ikeaCategories: ['fu006'],
      // Sets with a footstool are two pieces.
      skip: /footstool/i,
      size: (l) => box(l, 'Height', 'Height including back cushions'),
    },
  ],
  [
    'coffee_table',
    {
      ikeaCategories: ['10716'],
      // Adjustable ones lowered, as IKEA models them.
      size: (l) => table(l, l.first('Height', 'Min. height', 'Max. height')),
    },
  ],
  [
    'dining_table',
    { ikeaCategories: ['21825'], skip: /^tabletop$/i, size: (l) => table(l, l.first('Height')) },
  ],
  [
    'dining_chair',
    {
      // Upholstered and kitchen chairs; covers and seat shells have their own categories.
      ikeaCategories: ['25220', '25221'],
      size: (l) => box(l, 'Height', 'Max. height'),
    },
  ],
  [
    'desk',
    {
      // Desk systems also sell tabletops, legs, screens and cabinets.
      ikeaCategories: ['20649'],
      only: /^(gaming )?desk\b|^table$/i,
      size: (l) => {
        const fixed = l.optional('Total height') ?? l.optional('Height');
        const max = l.optional('Max. height') ?? Infinity;
        return table(l, fixed ?? Math.min(Math.max(DESK_HEIGHT, l.first('Min. height')), max));
      },
    },
  ],
  [
    'desk_chair',
    {
      ikeaCategories: ['20652'],
      skip: /^(headrest|seat pad|sit\/stand support)$/i,
      // At their lowest setting, as IKEA models them. The whole chair moves with its seat,
      // so without a listed minimum, the lowest height is the highest less the seat's range.
      size: (l) => {
        const max = l.optional('Max. height');
        const seatMax = l.optional('Max. seat height');
        const seatMin = l.optional('Min. seat height');
        const lowest =
          max != null && seatMax != null && seatMin != null ? max - (seatMax - seatMin) : max;
        const h =
          l.optional('Height') ??
          l.optional('Min. height') ??
          lowest ??
          l.first('Height', 'Min. height', 'Max. height');
        return rect(l.first('Width'), l.first('Depth'), h);
      },
    },
  ],
  [
    'shelving',
    {
      // Bookcases and shelf units. Wall shelves are out of scope.
      ikeaCategories: ['10382', '11465'],
      skip: /^(door|glass door|panel\/glass door|shelf|extra shelf|height extension unit|insert\b.*|base on legs|base frame|corner hardware|side panel|middle panel|drawer|cat house|wall shelf unit)$/i,
      size: (l) =>
        rect(
          l.first('Width', 'Frame, width', 'Frame width'),
          // Bookcases with a fold-out table: their everyday, folded depth.
          l.first('Depth', 'Frame, depth', 'Depth, folded', 'Depth, unfolded'),
          l.largest('Height', 'Frame height'),
        ),
    },
  ],
  [
    'wardrobe',
    {
      // Wardrobes & closets, and PAX wardrobes with and without doors.
      ikeaCategories: ['19053', '24337', '19110'],
      skip: /^add-on/i,
      size: (l) => box(l, 'Height'),
    },
  ],
  [
    'dresser',
    { ikeaCategories: ['10451'], skip: /^glass top$/i, size: (l) => box(l, 'Height') },
  ],
  [
    'nightstand',
    {
      ikeaCategories: ['20656'],
      skip: /wall-mounted/i,
      size: (l) =>
        l.has('Diameter') && !l.has('Width')
          ? round(l.first('Diameter'), l.first('Height'))
          : box(l, 'Height'),
    },
  ],
  [
    'tv_unit',
    {
      // TV stands & media furniture, and BESTÅ TV benches. TV storage combinations are left
      // out: they include wall-mounted cabinets.
      ikeaCategories: ['10475', '12153'],
      only: /^(tv bench|tv unit|gaming tv stand)/i,
      size: (l) => box(l, 'Height'),
    },
  ],
  [
    'rug',
    {
      ikeaCategories: ['10653'],
      skip: /mat$|underlay/i,
      size: (l) => {
        const h = l.optional('Thickness') ?? l.optional('Pile thickness') ?? RUG_THICKNESS;
        return l.has('Diameter') && !l.has('Length')
          ? round(l.first('Diameter'), h)
          : rect(l.first('Length'), l.first('Width'), h);
      },
    },
  ],
  [
    'floor_lamp',
    {
      ikeaCategories: ['10731'],
      // Round and as wide as the shade or base, except arc and arm lamps, which list a Length.
      size: (l) => {
        const h = l.first('Height', 'Total height', 'Max. height');
        const width = l.largest('Width', 'Shade width', 'Shade diameter', 'Base diameter');
        return l.has('Length') ? rect(l.first('Length'), width, h) : round(width, h);
      },
    },
  ],
];

export type ImportResult =
  | { ok: true; product: Product }
  | { ok: false; category: Category; reason: string };

/**
 * Map a scraped IKEA item to a catalog product. Returns undefined for items
 * outside the mapped categories.
 */
export function toProduct(item: IkeaItem, hasModel: boolean): ImportResult | undefined {
  const ids = new Set(item.categoryPath.map((c) => c.id));
  const match = CATEGORY_RULES.find(([, rule]) => rule.ikeaCategories.some((id) => ids.has(id)));
  if (!match) return undefined;
  const [category, rule] = match;
  const reject = (reason: string): ImportResult => ({ ok: false, category, reason });

  const description = item.description ?? '';
  const type = description.split(', ')[0] ?? '';
  if (
    L_SHAPED.test(description) ||
    item.measurements.some((m) => L_SHAPED_MEASUREMENTS.includes(m.name ?? ''))
  ) {
    return reject('L- or T-shaped (not supported yet)');
  }
  if (rule.skip?.test(type) || (rule.only && !rule.only.test(type))) {
    return reject('part, add-on or other product type');
  }
  if (item.currency !== 'CAD') {
    return reject(`price not in CAD (${item.currency ?? 'missing'})`);
  }

  let size: Size;
  try {
    size = rule.size(lengths(item), type);
  } catch (e) {
    if (e instanceof MissingMeasurement) return reject(e.message);
    throw e;
  }

  const parsed = Product.safeParse({
    articleNo: item.articleNo,
    // Its own family until the import groups variants (families.ts).
    familyId: item.articleNo,
    options: item.options,
    name: item.name,
    category,
    status: 'active',
    priceCad: item.priceCad,
    url: item.url,
    imageUrl: item.imageUrl,
    color: item.color,
    material: item.material,
    ...size,
    modelUrl: null,
    modelSource: hasModel ? 'ikea' : 'procedural',
    styleTags: [],
    scrapedAt: item.scrapedAt,
  });
  return parsed.success
    ? { ok: true, product: parsed.data }
    : reject(z.prettifyError(parsed.error));
}

/** IKEA item numbers are article numbers without the dots: 594.424.83 -> 59442483. */
export function itemNoOf(product: Pick<Product, 'articleNo'>): string {
  return product.articleNo.replaceAll('.', '');
}
