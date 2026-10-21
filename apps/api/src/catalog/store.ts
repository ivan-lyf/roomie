import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Product } from '@roomie/schema';
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
