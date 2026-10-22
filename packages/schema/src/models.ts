import { z } from 'zod';
import { Category, ModelSource } from './product';

/** What the model pipeline made of a product's IKEA model. */
export const ModelOutcome = z.enum([
  /** Within 10% of the listed dims. */
  'fitted',
  /** Off by 10–25%, and rescaled to the listed dims. */
  'rescaled',
  /** Off by more than 25%, so not used. */
  'off_size',
  /** The file couldn't be read or has no geometry. */
  'unreadable',
  /** IKEA has no model for the product, or it isn't downloaded. */
  'no_model',
]);
export type ModelOutcome = z.infer<typeof ModelOutcome>;

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** One product in data/models/manifest.json, written by `pnpm models:process`. */
export const ModelManifestEntry = z.object({
  itemNo: z.string(),
  category: Category,
  outcome: ModelOutcome,
  /** Which model data/models/<itemNo>.glb holds, or null when there is none. `outcome` is about
   * the product's own IKEA model, so a borrowed one keeps e.g. `no_model`. */
  source: ModelSource.nullable(),
  bytes: z.number().int().positive().nullable(),
  /** Scale applied on each axis to reach the listed dims. */
  scale: Vec3.nullable(),
  /** Bounds of the written file in meters, measured by reading it back. */
  bounds: z.object({ min: Vec3, max: Vec3 }).nullable().default(null),
  /** Size of the IKEA model used, before fitting: lets siblings borrow it without a re-read. */
  rawSize: Vec3.nullable().default(null),
  /** The sibling variant whose IKEA model this product shows, when it has none of its own. */
  fromItemNo: z.string().nullable().default(null),
  notes: z.array(z.string()),
  /** What the entry was built from, so unchanged products are skipped on the next run. */
  inputs: z.string(),
});
export type ModelManifestEntry = z.infer<typeof ModelManifestEntry>;

export const ModelManifest = z.object({
  pipelineVersion: z.number().int(),
  generatedAt: z.string(),
  entries: z.array(ModelManifestEntry),
});
export type ModelManifest = z.infer<typeof ModelManifest>;
