import { planStatus } from '@roomie/geometry';
import { Floorplan, LoggedIntent } from '@roomie/schema';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { floorplans, layouts } from '../db/schema';
import type { TestHome } from '../layouts/test-homes';

// The pool of layouts to rate (PLAN.md M7): the test homes, added to the database once each, and
// furnished again and again from their cached intents with new seeds, at no LLM cost.

/** JSON with its keys in order, since Postgres keeps JSONB's keys in an order of its own. */
const stable = (value: unknown) =>
  JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

/** What a layout stands on: two plans that differ here can't share layouts. */
const shape = (plan: Floorplan) =>
  stable([plan.walls, plan.openings, plan.rooms, plan.obstacles, plan.scale, plan.ceilingHeight]);

/**
 * The test home as a plan in the database, by name, added the first time with no image (dataset
 * samples stay on disk). Undefined when the one there has other walls or rooms, as when the plan
 * was read again since: its layouts belong to the plan as it was.
 */
export async function testHomePlan(
  db: Db,
  home: TestHome,
): Promise<{ plan: Floorplan; added: boolean } | undefined> {
  const [row] = await db
    .select()
    .from(floorplans)
    .where(and(eq(floorplans.source, 'test_set'), eq(floorplans.name, home.name)));
  if (row) {
    const plan = Floorplan.parse(row);
    return shape(plan) === shape(home.plan) ? { plan, added: false } : undefined;
  }
  const { plan } = home;
  const [added] = await db
    .insert(floorplans)
    .values({
      name: home.name,
      status: planStatus(plan),
      source: 'test_set',
      image: null,
      walls: plan.walls,
      openings: plan.openings,
      rooms: plan.rooms,
      obstacles: plan.obstacles,
      labels: plan.labels,
      scale: plan.scale,
      ceilingHeight: plan.ceilingHeight,
      ceilingHeightSource: plan.ceilingHeightSource,
      materials: plan.materials,
      reading: plan.reading,
    })
    .returning();
  return { plan: Floorplan.parse(added), added: true };
}

/**
 * The first seed not yet tried on this home's whole-home furnishings by this model, so each run
 * of the pool adds layouts rather than the same ones again.
 */
export async function nextSeed(db: Db, floorplanId: string, model: string): Promise<number> {
  const rows = await db
    .select({ llmIntent: layouts.llmIntent })
    .from(layouts)
    .where(and(eq(layouts.floorplanId, floorplanId), eq(layouts.status, 'winner')));
  const tried = rows.flatMap((row) => {
    const logged = LoggedIntent.safeParse(row.llmIntent);
    return logged.success && logged.data.mode === 'home' && logged.data.model === model
      ? (logged.data.seeds ?? [])
      : [];
  });
  return Math.max(0, ...tried) + 1;
}
