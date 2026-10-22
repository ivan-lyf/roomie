// Uploads the processed models to file storage, then writes the catalog
// (data/catalog/products.json) and the model pipeline's results (data/models/manifest.json)
// to the products table. Run after `pnpm models:process`.
import { loadConfig } from '../config';
import { createDb } from '../db/client';
import { createStorage } from '../storage';
import { publishCatalog } from './publish';
import { readModels, readProducts } from './store';
import { uploadModels } from './upload';

const config = loadConfig();
const db = createDb(config.databaseUrl);
try {
  const [catalog, models] = await Promise.all([
    readProducts(config.dataDir),
    readModels(config.dataDir),
  ]);
  if (models.size === 0) {
    console.warn('No model manifest yet, so products go out without models: run pnpm models:process.');
  }
  if (config.storage) {
    const itemNos = [...models.values()].filter((e) => e.source).map((e) => e.itemNo);
    console.log(`Uploading new and changed models to the ${config.storage.bucket} bucket…`);
    const storage = createStorage(config.storage);
    const { uploaded, unchanged } = await uploadModels(storage, config.dataDir, itemNos, (n) => {
      if (n % 250 === 0) console.log(`  ${n}/${itemNos.length}`);
    });
    console.log(`${uploaded} models uploaded, ${unchanged} already there`);
  } else {
    console.warn('No STORAGE_* settings, so the API serves the models from this machine.');
  }
  const { active, discontinued } = await publishCatalog(db, catalog, models);
  console.log(`${active} products published, ${discontinued} newly discontinued`);
} finally {
  await db.$client.end();
}
