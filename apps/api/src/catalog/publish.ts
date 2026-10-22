import type { ModelManifestEntry, Product } from '@roomie/schema';
import { and, eq, getTableColumns, notInArray, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { products } from '../db/schema';
import { itemNoOf } from './ikea';

/** Rows per insert: Postgres takes at most 65,535 parameters, and a product has about 20. */
const BATCH = 500;

export type PublishResult = { active: number; discontinued: number };

/** Where the browser loads a product's model; the API serves it from disk or R2. */
export const modelUrlOf = (itemNo: string) => `/api/models/${itemNo}.glb`;

/**
 * Writes the imported catalog to the products table, each product with the model the
 * pipeline made for it (`models`, from data/models/manifest.json). Products that are no
 * longer in the catalog are marked discontinued, never deleted, so layouts keep resolving them.
 */
export async function publishCatalog(
  db: Db,
  catalog: readonly Product[],
  models: ReadonlyMap<string, ModelManifestEntry>,
): Promise<PublishResult> {
  if (catalog.length === 0) throw new Error('refusing to publish an empty catalog');
  const rows = catalog.map((p) => {
    const itemNo = itemNoOf(p);
    const source = models.get(itemNo)?.source;
    return {
      ...p,
      status: 'active' as const,
      modelSource: source ?? 'procedural',
      modelUrl: source ? modelUrlOf(itemNo) : null,
    };
  });
  // On conflict, take every column from the new row.
  const set: Record<string, SQL> = {};
  for (const [key, column] of Object.entries(getTableColumns(products))) {
    if (key !== 'articleNo') set[key] = sql.raw(`excluded."${column.name}"`);
  }

  return db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      await tx
        .insert(products)
        .values(rows.slice(i, i + BATCH))
        .onConflictDoUpdate({ target: products.articleNo, set });
    }
    const gone = await tx
      .update(products)
      .set({ status: 'discontinued' })
      .where(
        and(
          eq(products.status, 'active'),
          notInArray(
            products.articleNo,
            rows.map((r) => r.articleNo),
          ),
        ),
      )
      .returning({ articleNo: products.articleNo });
    return { active: rows.length, discontinued: gone.length };
  });
}
