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

export const ModelSource = z.enum(['ikea', 'procedural']);
export type ModelSource = z.infer<typeof ModelSource>;

export const Product = z.object({
  articleNo: ArticleNo,
  name: z.string().min(1),
  category: Category,
  priceCad: z.number().nonnegative(),
  url: z.url(),
  dims: Dims,
  modelUrl: z.url().nullable(),
  modelSource: ModelSource,
  styleTags: z.array(z.string()),
  scrapedAt: z.coerce.date(),
});
export type Product = z.infer<typeof Product>;
