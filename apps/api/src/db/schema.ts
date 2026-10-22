import type {
  Category,
  Dims,
  GenerationInputs,
  LayoutStatus,
  Materials,
  ModelSource,
  Opening,
  Placement,
  ProductOption,
  ProductShape,
  Rating,
  RatingStatus,
  RoomType,
  Wall,
} from '@roomie/schema';
import { sql } from 'drizzle-orm';
import { index, jsonb, numeric, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Tables mirror the zod schemas in @roomie/schema (schema.test.ts checks they match).
// JSONB columns are typed here, but still validate them with zod on read and write.
// Every table enables RLS with no policies, so Supabase's public Data API can't touch it.
// The API connects as the table owner, which RLS doesn't apply to.

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const emptyTextArray = sql`'{}'::text[]`;

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  roomType: text('room_type').$type<RoomType>().notNull(),
  walls: jsonb('walls').$type<Wall[]>().notNull(),
  openings: jsonb('openings').$type<Opening[]>().notNull(),
  materials: jsonb('materials').$type<Materials>().notNull(),
  sourceImageUrl: text('source_image_url'),
  createdAt: createdAt(),
}).enableRLS();

export const products = pgTable(
  'products',
  {
    articleNo: text('article_no').primaryKey(),
    familyId: text('family_id').notNull(),
    options: jsonb('options').$type<ProductOption[]>().notNull(),
    name: text('name').notNull(),
    category: text('category').$type<Category>().notNull(),
    priceCad: numeric('price_cad', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    url: text('url').notNull(),
    imageUrl: text('image_url'),
    dims: jsonb('dims').$type<Dims>().notNull(),
    shape: text('shape').$type<ProductShape>().notNull(),
    extendedW: real('extended_w'),
    modelUrl: text('model_url'),
    modelSource: text('model_source').$type<ModelSource>().notNull(),
    styleTags: text('style_tags').array().notNull().default(emptyTextArray),
    scrapedAt: timestamp('scraped_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('products_category_idx').on(t.category),
    index('products_family_id_idx').on(t.familyId),
  ],
).enableRLS();

export const layouts = pgTable(
  'layouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id),
    generationId: uuid('generation_id').notNull(),
    inputs: jsonb('inputs').$type<GenerationInputs>().notNull(),
    placements: jsonb('placements').$type<Placement[]>().notNull(),
    score: real('score').notNull(),
    scoreBreakdown: jsonb('score_breakdown').$type<Record<string, number>>().notNull(),
    llmIntent: jsonb('llm_intent').$type<unknown>(),
    promptVersion: text('prompt_version').notNull(),
    status: text('status').$type<LayoutStatus>().notNull().default('candidate'),
    screenshotUrls: text('screenshot_urls').array().notNull().default(emptyTextArray),
    createdAt: createdAt(),
  },
  (t) => [
    index('layouts_room_id_idx').on(t.roomId),
    index('layouts_generation_id_idx').on(t.generationId),
  ],
).enableRLS();

export const ratings = pgTable('ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  layoutA: uuid('layout_a')
    .notNull()
    .references(() => layouts.id),
  layoutB: uuid('layout_b')
    .notNull()
    .references(() => layouts.id),
  winner: text('winner').$type<Rating['winner']>().notNull(),
  note: text('note'),
  status: text('status').$type<RatingStatus>().notNull().default('active'),
  createdAt: createdAt(),
}).enableRLS();
