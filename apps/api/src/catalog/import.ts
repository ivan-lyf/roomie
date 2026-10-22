// Turns scraped IKEA items (data/ikea/items.jsonl) into catalog products
// (data/catalog/products.json). M1 writes these to the products table instead.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Category, type Product } from '@roomie/schema';
import { loadConfig } from '../config';
import { type FamilyMember, familyIds } from './families';
import { IkeaItem, itemNoOf, toProduct } from './ikea';

const { dataDir } = loadConfig();
const itemsPath = path.join(dataDir, 'ikea', 'items.jsonl');
const outPath = path.join(dataDir, 'catalog', 'products.json');

/** Item numbers with a model downloaded by the scraper. */
const downloaded = new Set(
  (await readdir(path.join(dataDir, 'ikea', 'models')).catch(() => [] as string[]))
    .filter((file) => file.endsWith('.glb'))
    .map((file) => path.basename(file, '.glb')),
);

type Tally = { products: number; ikeaModels: number; downloaded: number; rejected: number };
const tallies = new Map<Category, Tally>(
  Category.options.map((c) => [c, { products: 0, ikeaModels: 0, downloaded: 0, rejected: 0 }]),
);
const rejected = new Map<string, number>();
const products: Product[] = [];
const members: FamilyMember[] = [];
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
  const result = toProduct(item, downloaded.has(item.itemNo));
  if (!result) {
    unmapped++;
  } else if (result.ok) {
    const { product } = result;
    products.push(product);
    members.push({
      itemNo: item.itemNo,
      articleNo: product.articleNo,
      category: product.category,
      variantItemNos: item.variantItemNos,
    });
    const tally = tallies.get(product.category)!;
    tally.products++;
    if (item.modelUrl) tally.ikeaModels++;
    if (product.modelSource === 'ikea') tally.downloaded++;
  } else {
    tallies.get(result.category)!.rejected++;
    const key = `${result.category}: ${result.reason}`;
    rejected.set(key, (rejected.get(key) ?? 0) + 1);
  }
}

// Variants that IKEA's pickers link share a family.
const familyOf = familyIds(members);
for (const product of products) {
  product.familyId = familyOf.get(itemNoOf(product)) ?? product.familyId;
}
const families = new Map(Category.options.map((c) => [c, new Set<string>()]));
for (const product of products) families.get(product.category)!.add(product.familyId);

products.sort((a, b) => a.articleNo.localeCompare(b.articleNo));
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(products, null, 2)}\n`);

console.table(
  Object.fromEntries(
    [...tallies].map(([category, t]) => [
      category,
      {
        products: t.products,
        families: families.get(category)!.size,
        'IKEA has a model': t.ikeaModels,
        'model downloaded': t.downloaded,
        rejected: t.rejected,
      },
    ]),
  ),
);
const familyCount = new Set(products.map((p) => p.familyId)).size;
console.log(`${products.length} products in ${familyCount} families -> ${outPath}`);
console.log(`${unmapped} items outside the mapped categories, ${unreadable} unreadable`);
for (const [reason, count] of [...rejected].sort((a, b) => b[1] - a[1])) {
  console.log(`rejected ${count}: ${reason}`);
}
