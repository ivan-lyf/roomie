// Turns scraped IKEA items (data/ikea/items.jsonl) into catalog products
// (data/catalog/products.json). M1 writes these to the products table instead.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Product } from '@roomie/schema';
import { loadConfig } from '../config';
import { IkeaItem, toProduct } from './ikea';

const { dataDir } = loadConfig();
const itemsPath = path.join(dataDir, 'ikea', 'items.jsonl');
const outPath = path.join(dataDir, 'catalog', 'products.json');

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

const products: Product[] = [];
const rejected = new Map<string, number>();
let unmapped = 0;
let unreadable = 0;

for (const line of (await readFile(itemsPath, 'utf8')).split('\n')) {
  if (!line.trim()) continue;
  let parsed;
  try {
    parsed = IkeaItem.safeParse(JSON.parse(line));
  } catch {
    parsed = undefined;
  }
  if (!parsed?.success) {
    unreadable++;
    continue;
  }
  const item = parsed.data;
  const hasModel = await exists(path.join(dataDir, 'ikea', 'models', `${item.itemNo}.glb`));
  const result = toProduct(item, hasModel);
  if (!result) unmapped++;
  else if (result.ok) products.push(result.product);
  else rejected.set(result.reason, (rejected.get(result.reason) ?? 0) + 1);
}

products.sort((a, b) => a.articleNo.localeCompare(b.articleNo));
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(products, null, 2)}\n`);

const withModels = products.filter((p) => p.modelSource === 'ikea').length;
console.log(`${products.length} products (${withModels} with IKEA models) -> ${outPath}`);
console.log(`${unmapped} items outside the mapped categories, ${unreadable} unreadable`);
for (const [reason, count] of [...rejected].sort((a, b) => b[1] - a[1])) {
  console.log(`rejected ${count}: ${reason}`);
}
