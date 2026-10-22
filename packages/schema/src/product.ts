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

export const ModelSource = z.enum(['ikea', 'procedural']);
export type ModelSource = z.infer<typeof ModelSource>;

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
  priceCad: z.number().nonnegative(),
  url: z.url(),
  imageUrl: z.url().nullable(),
  dims: Dims,
  shape: ProductShape,
  /** Width when fully extended (extendable tables); dims hold the everyday size. */
  extendedW: PositiveMeters.nullable(),
  modelUrl: z.url().nullable(),
  modelSource: ModelSource,
  styleTags: z.array(z.string()),
  scrapedAt: z.coerce.date(),
});
export type Product = z.infer<typeof Product>;
