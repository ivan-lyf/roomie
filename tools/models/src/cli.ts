// Normalizes downloaded IKEA models (data/ikea/models) into data/models, one
// GLB per catalog product. M1 adds compression and the upload to R2.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { type Category, Product } from '@roomie/schema';
import draco3d from 'draco3dgltf';
import { z } from 'zod';
import { normalizeModel, topBandCenterZ } from './normalize';

/** IKEA models already face +Z (checked on 116 sofa models, 2026-10-21). */
const IKEA_YAW = 0;
/** Scale changes above this get a warning, and above the hard limit the model is skipped. */
const WARN_SCALE_CHANGE = 0.1;
const MAX_SCALE_CHANGE = 0.25;
/** Categories whose tall part is at the back, so the facing check applies. */
const BACKED: ReadonlySet<Category> = new Set(['sofa', 'armchair', 'dining_chair', 'desk_chair']);

const dataDir = process.env.DATA_DIR || fileURLToPath(new URL('../../../data', import.meta.url));
const productsPath = path.join(dataDir, 'catalog', 'products.json');
const outDir = path.join(dataDir, 'models');

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });

const products = z.array(Product).parse(JSON.parse(await readFile(productsPath, 'utf8')));
await mkdir(outDir, { recursive: true });

type Row = { itemNo: string; name: string; scale: string; notes: string[] };
const rows: Row[] = [];
let written = 0;
let skipped = 0;

for (const product of products.filter((p) => p.modelSource === 'ikea')) {
  const itemNo = product.articleNo.replaceAll('.', '');
  const source = path.join(dataDir, 'ikea', 'models', `${itemNo}.glb`);
  if (!(await exists(source))) {
    rows.push({ itemNo, name: product.name, scale: '-', notes: ['no downloaded model'] });
    skipped++;
    continue;
  }
  const doc = await io.read(source);
  const { scale } = normalizeModel(doc, product.dims, IKEA_YAW);
  const change = Math.max(...scale.map((s) => Math.abs(s - 1)));
  const notes: string[] = [];
  if (change > MAX_SCALE_CHANGE) {
    rows.push({
      itemNo,
      name: product.name,
      scale: scale.map((s) => s.toFixed(2)).join(' '),
      notes: [`skipped: off its listed dims by ${Math.round(change * 100)}%`],
    });
    skipped++;
    continue;
  }
  if (change > WARN_SCALE_CHANGE) notes.push(`rescaled by up to ${Math.round(change * 100)}%`);
  if (BACKED.has(product.category) && topBandCenterZ(doc) > 0) {
    notes.push('check facing: its tallest part is not at the back');
  }
  // Write plain geometry so the browser needs no Draco decoder.
  doc
    .getRoot()
    .listExtensionsUsed()
    .find((e) => e.extensionName === KHRDracoMeshCompression.EXTENSION_NAME)
    ?.dispose();
  await writeFile(path.join(outDir, `${itemNo}.glb`), await io.writeBinary(doc));
  written++;
  rows.push({ itemNo, name: product.name, scale: scale.map((s) => s.toFixed(2)).join(' '), notes });
}

for (const row of rows.filter((r) => r.notes.length > 0)) {
  console.log(`${row.itemNo} ${row.name} [scale ${row.scale}]: ${row.notes.join('; ')}`);
}
console.log(`${written} models written to ${outDir}, ${skipped} skipped`);
