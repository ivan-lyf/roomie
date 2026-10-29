import type {
  Category,
  CeilingHeightSource,
  Dims,
  FloorplanStatus,
  GenerationInputs,
  LayoutStatus,
  LlmRoute,
  Materials,
  ModelSource,
  Obstacle,
  Opening,
  Placement,
  PlanImage,
  PlanReading,
  PlanText,
  ProductOption,
  ProductShape,
  ProductStatus,
  Rating,
  RatingStatus,
  Room,
  Scale,
  Usage,
  Wall,
} from '@roomie/schema';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Tables mirror the zod schemas in @roomie/schema (schema.test.ts checks they match).
// JSONB columns are typed here, but still validate them with zod on read and write.
// Every table enables RLS with no policies, so Supabase's public Data API can't touch it.
// The API connects as the table owner, which RLS doesn't apply to.

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const emptyTextArray = sql`'{}'::text[]`;

/** A home's plan: walls, openings and rooms in meters (plan space, see CLAUDE.md). */
export const floorplans = pgTable('floorplans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: text('status').$type<FloorplanStatus>().notNull(),
  image: jsonb('image').$type<PlanImage>(),
  walls: jsonb('walls').$type<Wall[]>().notNull(),
  openings: jsonb('openings').$type<Opening[]>().notNull(),
  rooms: jsonb('rooms').$type<Room[]>().notNull(),
  obstacles: jsonb('obstacles').$type<Obstacle[]>().notNull(),
  labels: jsonb('labels').$type<PlanText[]>().notNull(),
  scale: jsonb('scale').$type<Scale>(),
  ceilingHeight: real('ceiling_height').notNull(),
  ceilingHeightSource: text('ceiling_height_source').$type<CeilingHeightSource>().notNull(),
  materials: jsonb('materials').$type<Materials>().notNull(),
  reading: jsonb('reading').$type<PlanReading>(),
  furniture: jsonb('furniture')
    .$type<Placement[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** The generated layout the furniture was copied from, if any. */
  furnishedFrom: uuid('furnished_from').references((): AnyPgColumn => layouts.id),
  editSeconds: integer('edit_seconds').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const products = pgTable(
  'products',
  {
    articleNo: text('article_no').primaryKey(),
    familyId: text('family_id').notNull(),
    options: jsonb('options').$type<ProductOption[]>().notNull(),
    name: text('name').notNull(),
    category: text('category').$type<Category>().notNull(),
    status: text('status').$type<ProductStatus>().notNull().default('active'),
    priceCad: numeric('price_cad', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    url: text('url').notNull(),
    imageUrl: text('image_url'),
    color: text('color'),
    material: text('material'),
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
    floorplanId: uuid('floorplan_id')
      .notNull()
      .references(() => floorplans.id),
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
    index('layouts_floorplan_id_idx').on(t.floorplanId),
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

/** Each request that called an LLM, by account, for the daily allowance (PLAN.md M6). */
export const usage = pgTable(
  'usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // A Supabase Auth user; auth.users lives in another schema, and not in tests' database.
    accountId: uuid('account_id').notNull(),
    route: text('route').$type<LlmRoute>().notNull(),
    floorplanId: uuid('floorplan_id').references(() => floorplans.id),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6, mode: 'number' }),
    cached: boolean('cached').notNull().default(false),
    status: text('status').$type<Usage['status']>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('usage_account_created_idx').on(t.accountId, t.createdAt)],
).enableRLS();
