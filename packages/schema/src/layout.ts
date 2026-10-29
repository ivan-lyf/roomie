import { z } from 'zod';
import { Radians } from './geometry';
import type { RoomType } from './floorplan';
import { ArticleNo, Category } from './product';

// Placeholder presets; revisit once the catalog's style tags are known.
export const StylePreset = z.enum(['scandinavian', 'modern', 'warm_minimal']);
export type StylePreset = z.infer<typeof StylePreset>;

export const GenerationInputs = z.object({
  /** The rooms to furnish: by default every furnishable room of the floorplan. */
  roomIds: z.array(z.string().min(1)).min(1),
  /** One budget for the whole home. */
  budgetCad: z.number().positive(),
  /** One style, shared by every room. */
  style: StylePreset,
  /** What each room must have, by room id. */
  mustHaves: z.record(z.string(), z.array(Category)),
});
export type GenerationInputs = z.infer<typeof GenerationInputs>;

/** One item standing in a room: its footprint's center, in plan space, and which way it faces. */
export const Placement = z.object({
  /** Unique within the floorplan or layout: two identical chairs are two placements. */
  id: z.string().min(1),
  articleNo: ArticleNo,
  /** The room the item stands in. */
  roomId: z.string().min(1),
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
  floorplanId: z.uuid(),
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

/** The categories that suit each furnishable room, the essentials first. */
export const ROOM_CATEGORIES: Partial<Record<RoomType, Category[]>> = {
  living_room: ['sofa', 'coffee_table', 'tv_unit', 'armchair', 'shelving', 'rug', 'floor_lamp'],
  bedroom: ['bed', 'nightstand', 'wardrobe', 'dresser', 'rug', 'floor_lamp', 'desk', 'desk_chair'],
  studio: [
    'bed',
    'sofa',
    'coffee_table',
    'nightstand',
    'wardrobe',
    'dining_table',
    'dining_chair',
    'tv_unit',
    'desk',
    'desk_chair',
    'shelving',
    'rug',
    'floor_lamp',
  ],
  dining_area: ['dining_table', 'dining_chair', 'shelving', 'rug', 'floor_lamp'],
  den_office: ['desk', 'desk_chair', 'shelving', 'armchair', 'floor_lamp', 'rug'],
};

/** How one room is going in a furnishing. */
export const RoomProgress = z.object({
  roomId: z.string().min(1),
  status: z.enum(['waiting', 'done', 'failed']),
  /** Why a room is missing items, or wasn't furnished. */
  reasons: z.array(z.string()).optional(),
});
export type RoomProgress = z.infer<typeof RoomProgress>;

/** A furnishing under way or done, as the browser polls for it. */
export const GenerationJob = z.object({
  generationId: z.uuid(),
  floorplanId: z.uuid(),
  status: z.enum(['running', 'done', 'failed']),
  rooms: z.array(RoomProgress),
  /** Why it failed, in words. */
  error: z.string().optional(),
  /** The winning layout, now the home's furniture. */
  layoutId: z.uuid().optional(),
  furniture: z.array(Placement).optional(),
  /** What the LLM calls cost, in dollars, when the model's price is known. */
  costUsd: z.number().optional(),
});
export type GenerationJob = z.infer<typeof GenerationJob>;
