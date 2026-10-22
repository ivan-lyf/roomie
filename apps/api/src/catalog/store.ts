import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ModelManifest, type ModelManifestEntry, Product } from '@roomie/schema';
import { z } from 'zod';

const ProductList = z.array(Product);

/** Products from data/catalog/products.json, validated on read. Empty until `pnpm catalog:import`. */
export async function readProducts(dataDir: string): Promise<Product[]> {
  let text: string;
  try {
    text = await readFile(path.join(dataDir, 'catalog', 'products.json'), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return ProductList.parse(JSON.parse(text));
}

/** A processed model written by `pnpm models:process`. */
export function modelPath(dataDir: string, itemNo: string): string {
  return path.join(dataDir, 'models', `${itemNo}.glb`);
}

/** Processed models by item number, from data/models/manifest.json. Empty before `pnpm models:process`. */
export async function readModels(dataDir: string): Promise<Map<string, ModelManifestEntry>> {
  let text: string;
  try {
    text = await readFile(path.join(dataDir, 'models', 'manifest.json'), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw e;
  }
  return new Map(ModelManifest.parse(JSON.parse(text)).entries.map((e) => [e.itemNo, e]));
}

/** data/catalog/report.json, written by `pnpm catalog:import`. */
export const ImportReport = z.object({
  generatedAt: z.string(),
  products: z.number().int(),
  families: z.number().int(),
  unmapped: z.number().int(),
  unreadable: z.number().int(),
  /** Reasons as "category: reason", most common first. */
  rejected: z.array(z.object({ reason: z.string(), count: z.number().int() })),
});
export type ImportReport = z.infer<typeof ImportReport>;

export async function readImportReport(dataDir: string): Promise<ImportReport | undefined> {
  try {
    const text = await readFile(path.join(dataDir, 'catalog', 'report.json'), 'utf8');
    return ImportReport.parse(JSON.parse(text));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}
