// Checks the published catalog: every active product has sound data and a model that
// matches its listed size. Exits with an error if any product fails. Run after publishing.
import { access } from 'node:fs/promises';
import { Category, Product } from '@roomie/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { loadConfig } from '../config';
import { createDb } from '../db/client';
import { createStorage } from '../storage';
import { products } from '../db/schema';
import { productProblems } from './check';
import { itemNoOf } from './ikea';
import { modelPath, readImportReport, readModels } from './store';

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

const { dataDir, databaseUrl, storage } = loadConfig();
const db = createDb(databaseUrl);
try {
  const rows = await db.select().from(products).where(eq(products.status, 'active'));
  const active = z.array(Product).parse(rows);
  const models = await readModels(dataDir);
  // The models the API serves: in the bucket, or on this machine without storage settings.
  const stored = storage ? await createStorage(storage).list() : undefined;
  const hasFile = async (itemNo: string) =>
    stored ? stored.has(`${itemNo}.glb`) : exists(modelPath(dataDir, itemNo));

  type Row = { products: number; 'IKEA model': number; 'stand-in': number; failed: number };
  const table = Object.fromEntries(
    Category.options.map((c): [Category, Row] => [
      c,
      { products: 0, 'IKEA model': 0, 'stand-in': 0, failed: 0 },
    ]),
  );
  const failed: string[] = [];
  for (const product of active) {
    const itemNo = itemNoOf(product);
    const model = models.get(itemNo);
    const problems = productProblems(product, model);
    if (model?.source && !(await hasFile(itemNo))) {
      problems.push(storage ? 'model not in the storage bucket' : 'model file missing');
    }
    const row = table[product.category]!;
    row.products++;
    row[product.modelSource === 'ikea' ? 'IKEA model' : 'stand-in']++;
    if (problems.length > 0) {
      row.failed++;
      failed.push(`${product.articleNo} ${product.name}: ${problems.join('; ')}`);
    }
  }
  console.table(table);
  const ikea = active.filter((p) => p.modelSource === 'ikea').length;
  console.log(
    `${active.length} active products, ${Math.round((ikea / Math.max(active.length, 1)) * 100)}% ` +
      'with an IKEA model, the rest with stand-ins',
  );

  const report = await readImportReport(dataDir);
  if (report) {
    console.log(`\nThe import rejected ${report.rejected.reduce((n, r) => n + r.count, 0)} items:`);
    for (const { reason, count } of report.rejected.slice(0, 12)) console.log(`  ${count} ${reason}`);
  }

  console.log();
  for (const line of failed.slice(0, 50)) console.log(`✗ ${line}`);
  if (failed.length > 50) console.log(`… and ${failed.length - 50} more`);
  console.log(failed.length > 0 ? `${failed.length} products failed` : '✓ every product passed');
  process.exitCode = failed.length > 0 ? 1 : 0;
} finally {
  await db.$client.end();
}
