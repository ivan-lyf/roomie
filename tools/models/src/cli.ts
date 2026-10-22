// Fits each catalog product's downloaded IKEA model (data/ikea/models) to the conventions
// in CLAUDE.md and writes it to data/models. data/models/manifest.json records what happened
// to every product, and unchanged products are skipped on the next run.
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import {
  Category,
  ModelManifest,
  type ModelManifestEntry,
  ModelOutcome,
  Product,
} from '@roomie/schema';
import draco3d from 'draco3dgltf';
import { z } from 'zod';
import { normalizeModel, topBandCenterZ } from './normalize';

/** Bump when the processing changes, so every model is redone. */
const PIPELINE_VERSION = 1;
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
const manifestPath = path.join(outDir, 'manifest.json');

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
const previous = new Map((await readManifest()).map((e) => [e.itemNo, e]));

const entries: ModelManifestEntry[] = [];
let reused = 0;
for (const product of products) {
  const itemNo = product.articleNo.replaceAll('.', '');
  const source = path.join(dataDir, 'ikea', 'models', `${itemNo}.glb`);
  const out = path.join(outDir, `${itemNo}.glb`);
  const sourceStat = await stat(source).catch(() => null);
  const inputs = [
    PIPELINE_VERSION,
    sourceStat?.size ?? 0,
    sourceStat?.mtimeMs ?? 0,
    JSON.stringify(product.dims),
    product.shape,
  ].join(':');

  const before = previous.get(itemNo);
  if (before?.inputs === inputs && (before.source === null || (await exists(out)))) {
    entries.push(before);
    reused++;
    continue;
  }
  const entry = { itemNo, category: product.category, inputs };
  entries.push(
    sourceStat
      ? await processModel(product, source, out, entry)
      : { ...entry, ...empty('no_model') },
  );
}

// Outputs of products that left the catalog or lost their model.
const keep = new Set(entries.filter((e) => e.source).map((e) => `${e.itemNo}.glb`));
for (const file of await readdir(outDir)) {
  if (file.endsWith('.glb') && !keep.has(file)) await rm(path.join(outDir, file));
}
const manifest: ModelManifest = {
  pipelineVersion: PIPELINE_VERSION,
  generatedAt: new Date().toISOString(),
  entries: entries.sort((a, b) => a.itemNo.localeCompare(b.itemNo)),
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
report(entries, reused);

type Fields = Pick<ModelManifestEntry, 'itemNo' | 'category' | 'inputs'>;

async function processModel(
  product: Product,
  source: string,
  out: string,
  fields: Fields,
): Promise<ModelManifestEntry> {
  let doc;
  let scale;
  try {
    doc = await io.read(source);
    ({ scale } = normalizeModel(doc, product.dims, IKEA_YAW));
  } catch (e) {
    return { ...fields, ...empty('unreadable'), notes: [e instanceof Error ? e.message : String(e)] };
  }
  const rounded = scale.map((s) => Math.round(s * 1000) / 1000) as [number, number, number];
  const change = Math.max(...scale.map((s) => Math.abs(s - 1)));
  if (change > MAX_SCALE_CHANGE) {
    const notes = [`off its listed dims by ${Math.round(change * 100)}%`];
    return { ...fields, ...empty('off_size'), scale: rounded, notes };
  }
  const notes: string[] = [];
  if (BACKED.has(product.category) && topBandCenterZ(doc) > 0) {
    notes.push('check facing: its tallest part is not at the back');
  }
  // Write plain geometry so the browser needs no Draco decoder.
  doc
    .getRoot()
    .listExtensionsUsed()
    .find((e) => e.extensionName === KHRDracoMeshCompression.EXTENSION_NAME)
    ?.dispose();
  const glb = await io.writeBinary(doc);
  await writeFile(out, glb);
  return {
    ...fields,
    outcome: change > WARN_SCALE_CHANGE ? 'rescaled' : 'fitted',
    source: 'ikea',
    bytes: glb.byteLength,
    scale: rounded,
    notes,
  };
}

function empty(outcome: ModelOutcome) {
  return { outcome, source: null, bytes: null, scale: null, notes: [] };
}

async function readManifest(): Promise<ModelManifestEntry[]> {
  let text;
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch {
    return [];
  }
  const parsed = ModelManifest.safeParse(JSON.parse(text));
  return parsed.success && parsed.data.pipelineVersion === PIPELINE_VERSION
    ? parsed.data.entries
    : [];
}

function report(all: ModelManifestEntry[], reusedCount: number) {
  const table: Record<string, Record<string, number>> = {};
  for (const category of Category.options) {
    const rows = all.filter((e) => e.category === category);
    table[category] = Object.fromEntries(
      ModelOutcome.options.map((o) => [o, rows.filter((e) => e.outcome === o).length]),
    );
  }
  console.table(table);
  const flagged = all.filter((e) => e.notes.some((n) => n.startsWith('check facing')));
  for (const e of flagged.slice(0, 20)) console.log(`check facing: ${e.itemNo} (${e.category})`);
  if (flagged.length > 20) console.log(`... and ${flagged.length - 20} more facing flags`);
  const written = all.filter((e) => e.source).length;
  console.log(
    `${written} models in ${outDir} (${reusedCount} unchanged), manifest: ${manifestPath}`,
  );
}
