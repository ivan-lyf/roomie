import { z } from 'zod';
import { Radians } from './geometry';
import { ArticleNo, Category } from './product';
import { RoomType } from './room';

// Placeholder presets; revisit once the catalog's style tags are known.
export const StylePreset = z.enum(['scandinavian', 'modern', 'warm_minimal']);
export type StylePreset = z.infer<typeof StylePreset>;

export const GenerationInputs = z.object({
  roomType: RoomType,
  budgetCad: z.number().positive(),
  style: StylePreset,
  mustHaves: z.array(Category),
});
export type GenerationInputs = z.infer<typeof GenerationInputs>;

export const Placement = z.object({
  articleNo: ArticleNo,
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: Radians,
});
export type Placement = z.infer<typeof Placement>;

/** Never delete layouts; change the status instead. */
export const LayoutStatus = z.enum(['candidate', 'winner', 'archived']);
export type LayoutStatus = z.infer<typeof LayoutStatus>;

export const Layout = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  /** Groups the best-of-N candidates from one generation request. */
  generationId: z.uuid(),
  inputs: GenerationInputs,
  placements: z.array(Placement),
  score: z.number().min(0).max(1),
  scoreBreakdown: z.record(z.string(), z.number()),
  llmIntent: z.unknown(),
  promptVersion: z.string().min(1),
  status: LayoutStatus,
  screenshotUrls: z.array(z.url()),
  createdAt: z.coerce.date(),
});
export type Layout = z.infer<typeof Layout>;

/** Never delete ratings; change the status instead. */
export const RatingStatus = z.enum(['active', 'archived']);
export type RatingStatus = z.infer<typeof RatingStatus>;

export const Rating = z.object({
  id: z.uuid(),
  layoutA: z.uuid(),
  layoutB: z.uuid(),
  winner: z.enum(['a', 'b']),
  note: z.string().nullable(),
  status: RatingStatus,
  createdAt: z.coerce.date(),
});
export type Rating = z.infer<typeof Rating>;
