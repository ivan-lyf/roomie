// Writes the catalog (data/catalog/products.json) and the model pipeline's results
// (data/models/manifest.json) to the products table. Run after `pnpm models:process`.
import { loadConfig } from '../config';
import { createDb } from '../db/client';
import { publishCatalog } from './publish';
import { readModels, readProducts } from './store';

const { dataDir, databaseUrl } = loadConfig();
const db = createDb(databaseUrl);
try {
  const [catalog, models] = await Promise.all([readProducts(dataDir), readModels(dataDir)]);
  if (models.size === 0) {
    console.warn('No model manifest yet, so products go out without models: run pnpm models:process.');
  }
  const { active, discontinued } = await publishCatalog(db, catalog, models);
  console.log(`${active} products published, ${discontinued} newly discontinued`);
} finally {
  await db.$client.end();
}
