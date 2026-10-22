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

/** One product in data/models/manifest.json, written by `pnpm models:process`. */
export const ModelManifestEntry = z.object({
  itemNo: z.string(),
  category: Category,
  outcome: ModelOutcome,
  /** Which model data/models/<itemNo>.glb holds, or null when there is none. */
  source: ModelSource.nullable(),
  bytes: z.number().int().positive().nullable(),
  /** Scale applied on each axis to reach the listed dims. */
  scale: z.tuple([z.number(), z.number(), z.number()]).nullable(),
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
