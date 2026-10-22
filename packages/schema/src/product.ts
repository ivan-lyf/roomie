import { z } from 'zod';
import { PositiveMeters } from './geometry';

export const Category = z.enum([
  'bed',
  'sofa',
  'armchair',
  'coffee_table',
  'dining_table',
  'dining_chair',
  'desk',
  'desk_chair',
  'shelving',
  'wardrobe',
  'dresser',
  'nightstand',
  'tv_unit',
  'rug',
  'floor_lamp',
]);
export type Category = z.infer<typeof Category>;

/** IKEA article number, e.g. "123.456.78". */
export const ArticleNo = z.string().regex(/^\d{3}\.\d{3}\.\d{2}$/);

/** Product dimensions in meters: w = local X, d = local Z, h = local Y. */
export const Dims = z.object({
  w: PositiveMeters,
  d: PositiveMeters,
  h: PositiveMeters,
});
export type Dims = z.infer<typeof Dims>;

/** Footprint outline. Round products have w = d = their diameter. */
export const ProductShape = z.enum(['rect', 'round']);
export type ProductShape = z.infer<typeof ProductShape>;

/** The product's own IKEA model, a sibling variant's (another color or size), or a stand-in. */
export const ModelSource = z.enum(['ikea', 'ikea_variant', 'procedural']);
export type ModelSource = z.infer<typeof ModelSource>;

/** Products are never deleted, so layouts keep resolving them; gone from IKEA is discontinued. */
export const ProductStatus = z.enum(['active', 'discontinued']);
export type ProductStatus = z.infer<typeof ProductStatus>;

/** One option a variant is picked by, e.g. { name: 'Color', value: 'White' }. */
export const ProductOption = z.object({ name: z.string().min(1), value: z.string().min(1) });
export type ProductOption = z.infer<typeof ProductOption>;

export const Product = z.object({
  articleNo: ArticleNo,
  /** Shared by the variants of one design: the lowest article number among them. */
  familyId: ArticleNo,
  /** What sets this variant apart within its family, in the order IKEA's pickers show. */
  options: z.array(ProductOption),
  name: z.string().min(1),
  category: Category,
  status: ProductStatus,
  priceCad: z.number().nonnegative(),
  url: z.url(),
  imageUrl: z.url().nullable(),
  /** IKEA's own words, e.g. "beige, brown" and "Solid wood", for matching a style across rooms. */
  color: z.string().nullable(),
  material: z.string().nullable(),
  dims: Dims,
  shape: ProductShape,
  /** Width when fully extended (extendable tables); dims hold the everyday size. */
  extendedW: PositiveMeters.nullable(),
  /** Where the browser loads the model: the API's /api/models/<itemNo>.glb, or a full URL. */
  modelUrl: z.string().regex(/^(\/[^/]|https?:\/\/)/).nullable(),
  modelSource: ModelSource,
  styleTags: z.array(z.string()),
  scrapedAt: z.coerce.date(),
});
export type Product = z.infer<typeof Product>;
