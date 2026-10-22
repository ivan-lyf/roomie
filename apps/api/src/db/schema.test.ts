import type { Floorplan, Layout, Product, Rating } from '@roomie/schema';
import type { InferSelectModel } from 'drizzle-orm';
import { describe, expectTypeOf, it } from 'vitest';
import type { floorplans, layouts, products, ratings } from './schema';

// Type-level checks: `pnpm typecheck` fails if a table drifts from its zod schema.
describe('db schema', () => {
  it('matches the zod schemas', () => {
    expectTypeOf<InferSelectModel<typeof floorplans>>().toEqualTypeOf<Floorplan>();
    expectTypeOf<InferSelectModel<typeof products>>().toEqualTypeOf<Product>();
    expectTypeOf<InferSelectModel<typeof layouts>>().toEqualTypeOf<Layout>();
    expectTypeOf<InferSelectModel<typeof ratings>>().toEqualTypeOf<Rating>();
  });
});
