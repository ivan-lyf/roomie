import type { Category, ModelManifestEntry, Product } from '@roomie/schema';

/** The default ceiling height (PLAN.md §5.1): anything taller wouldn't fit most rooms. */
export const DEFAULT_CEILING_M = 2.44;
/** How far a model's bounds may be from the listed dims, and its origin from the bottom center. */
export const TOLERANCE_M = 0.01;

type Range = [min: number, max: number];

/** Plausible sizes per category in meters. A size outside them means the data is wrong. */
const PLAUSIBLE: Record<Category, { w: Range; d: Range; h: Range }> = {
  bed: { w: [0.7, 2.5], d: [1, 2.6], h: [0.15, 2] },
  sofa: { w: [0.7, 4.2], d: [0.6, 1.9], h: [0.5, 1.3] },
  armchair: { w: [0.4, 1.5], d: [0.4, 1.6], h: [0.5, 1.4] },
  coffee_table: { w: [0.3, 1.8], d: [0.3, 1.2], h: [0.2, 0.8] },
  dining_table: { w: [0.5, 3], d: [0.5, 1.4], h: [0.6, 1.1] },
  dining_chair: { w: [0.3, 0.8], d: [0.3, 0.8], h: [0.6, 1.2] },
  desk: { w: [0.5, 2.5], d: [0.35, 1.3], h: [0.5, 2.2] },
  desk_chair: { w: [0.4, 0.9], d: [0.4, 0.9], h: [0.6, 1.5] },
  shelving: { w: [0.2, 4], d: [0.15, 0.8], h: [0.3, 2.5] },
  wardrobe: { w: [0.4, 4.5], d: [0.3, 0.8], h: [0.8, 2.5] },
  dresser: { w: [0.3, 2], d: [0.3, 0.7], h: [0.3, 1.6] },
  nightstand: { w: [0.25, 0.7], d: [0.25, 0.6], h: [0.3, 0.9] },
  tv_unit: { w: [0.6, 3], d: [0.25, 0.6], h: [0.3, 1] },
  rug: { w: [0.3, 4], d: [0.3, 4], h: [0.002, 0.06] },
  floor_lamp: { w: [0.1, 1.8], d: [0.1, 1], h: [0.3, 2.2] },
};

const IKEA_PRODUCT_URL = /^https:\/\/www\.ikea\.com\/ca\/en\/p\//;

/**
 * Everything wrong with a published product, from its data and from the model the pipeline
 * wrote for it (`model`, from data/models/manifest.json). Empty when it's fine.
 */
export function productProblems(product: Product, model: ModelManifestEntry | undefined): string[] {
  const problems: string[] = [];
  if (product.priceCad <= 0) problems.push('no price');
  if (!IKEA_PRODUCT_URL.test(product.url)) problems.push('not an IKEA.ca product link');
  for (const key of ['w', 'd', 'h'] as const) {
    const [min, max] = PLAUSIBLE[product.category][key];
    const value = product.dims[key];
    if (value < min || value > max) problems.push(`${key} = ${value} m is outside ${min}–${max} m`);
  }
  if (product.dims.h > DEFAULT_CEILING_M) {
    problems.push(`taller than the ${DEFAULT_CEILING_M} m default ceiling`);
  }
  if (!product.modelUrl || !model?.source) return [...problems, 'no model'];
  if (!model.bounds) return [...problems, 'model not measured: re-run pnpm models:process'];

  const { min, max } = model.bounds;
  const [x, y, z] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const { w, d, h } = product.dims;
  // A round product only has to reach its diameter on its wider side.
  const off =
    product.shape === 'round'
      ? Math.max(Math.abs(Math.max(x, z) - w), Math.abs(y - h))
      : Math.max(Math.abs(x - w), Math.abs(y - h), Math.abs(z - d));
  if (off > TOLERANCE_M) problems.push(`model is off its listed size by ${Math.round(off * 100)} cm`);
  const origin = Math.max(
    Math.abs(min[1]),
    Math.abs((min[0] + max[0]) / 2),
    Math.abs((min[2] + max[2]) / 2),
  );
  if (origin > TOLERANCE_M) problems.push('model origin is not at its bottom center');
  return problems;
}
