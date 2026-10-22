// Fits each catalog product's downloaded IKEA model (data/ikea/models) to the conventions
// in CLAUDE.md and writes it to data/models, or a stand-in when there's no usable IKEA model,
// so every product has one. data/models/manifest.json records what happened to every product,
// and unchanged products are skipped on the next run.
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import {
  Category,
  ModelManifest,
  type ModelManifestEntry,
  ModelOutcome,
  Product,
} from '@roomie/schema';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { z } from 'zod';
import { BACKED, chooseYaw, scaleChange } from './fit';
import { facesBackwards, normalizeModel, sourceSize } from './normalize';
import { optimizeModel } from './optimize';
import { standInModel } from './procedural';

/** Bump when the processing changes, so every model is redone. */
const PIPELINE_VERSION = 5;
/** IKEA models already face +Z (checked on 116 sofas and 75 models across all categories). */
const IKEA_YAW = 0;
/** Scale changes above this get a warning, and above the hard limit the model is skipped. */
const WARN_SCALE_CHANGE = 0.1;
const MAX_SCALE_CHANGE = 0.25;
/** Models bigger than this get a note: they slow down a furnished home. */
const SIZE_BUDGET_BYTES = 1024 * 1024;

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
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': await MeshoptDecoder.ready.then(() => MeshoptDecoder),
    'meshopt.encoder': MeshoptEncoder,
  })
  // Per-model details go in the manifest instead.
  .setLogger(new Logger(Logger.Verbosity.ERROR));

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
    product.color,
  ].join(':');

  const before = previous.get(itemNo);
  if (before?.inputs === inputs && (await exists(out))) {
    entries.push(before.bounds ? before : { ...before, bounds: await measure(out) });
    reused++;
    continue;
  }
  const fields = { itemNo, category: product.category, inputs };
  const entry = sourceStat
    ? await processModel(product, source, out, fields)
    : { ...fields, ...empty('no_model') };
  entries.push(entry.source ? entry : await writeStandIn(product, out, entry));
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
  let turn;
  try {
    doc = await io.read(source);
    turn = chooseYaw(sourceSize(doc), product);
    const round = product.shape === 'round';
    ({ scale } = normalizeModel(doc, product.dims, { yaw: IKEA_YAW + turn, round }));
  } catch (e) {
    const notes = [e instanceof Error ? e.message : String(e)];
    return { ...fields, ...empty('unreadable'), notes };
  }
  const rounded = scale.map((s) => Math.round(s * 1000) / 1000) as [number, number, number];
  const change = scaleChange(scale, product.category);
  const notes: string[] = turn ? ['turned a quarter to fit'] : [];
  if (change > MAX_SCALE_CHANGE) {
    notes.push(`off its listed dims by ${Math.round(change * 100)}%`);
    return { ...fields, ...empty('off_size'), scale: rounded, notes };
  }
  if (BACKED.has(product.category) && facesBackwards(doc, product.dims.d)) {
    notes.push('check facing: its tallest part is not at the back');
  }
  // Meshopt replaces Draco: three.js decodes it without fetching a decoder.
  doc
    .getRoot()
    .listExtensionsUsed()
    .find((e) => e.extensionName === KHRDracoMeshCompression.EXTENSION_NAME)
    ?.dispose();
  await optimizeModel(doc);
  const glb = await io.writeBinary(doc);
  await writeFile(out, glb);
  const bounds = await measure(out);
  if (glb.byteLength > SIZE_BUDGET_BYTES) {
    notes.push(`over 1 MB (${(glb.byteLength / SIZE_BUDGET_BYTES).toFixed(1)} MB)`);
  }
  return {
    ...fields,
    outcome: change > WARN_SCALE_CHANGE ? 'rescaled' : 'fitted',
    source: 'ikea',
    bytes: glb.byteLength,
    scale: rounded,
    bounds,
    notes,
  };
}

async function writeStandIn(
  product: Product,
  out: string,
  entry: ModelManifestEntry,
): Promise<ModelManifestEntry> {
  const doc = standInModel(product.category, product.dims, product.shape, product.color);
  const glb = await io.writeBinary(doc);
  await writeFile(out, glb);
  return { ...entry, source: 'procedural', bytes: glb.byteLength, bounds: await measure(out) };
}

/** Bounds of a written model, read back from the file as the browser would load it. */
async function measure(file: string): Promise<ModelManifestEntry['bounds']> {
  const doc = await io.read(file);
  const { min, max } = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!);
  const mm = (v: ArrayLike<number>) => [0, 1, 2].map((i) => Math.round(v[i]! * 1000) / 1000);
  return { min: mm(min), max: mm(max) } as NonNullable<ModelManifestEntry['bounds']>;
}

function empty(outcome: ModelOutcome) {
  return { outcome, source: null, bytes: null, scale: null, bounds: null, notes: [] };
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
  const ikea = all.filter((e) => e.source === 'ikea');
  const bytes = ikea.reduce((sum, e) => sum + (e.bytes ?? 0), 0);
  const big = ikea.filter((e) => (e.bytes ?? 0) > SIZE_BUDGET_BYTES).length;
  console.log(
    `${ikea.length} IKEA models, ${(bytes / 2 ** 20).toFixed(0)} MB in all, ` +
      `${(bytes / 2 ** 10 / Math.max(ikea.length, 1)).toFixed(0)} KB on average, ${big} over 1 MB`,
  );
  console.log(`${all.filter((e) => e.source === 'procedural').length} stand-ins`);
  console.log(`${reusedCount} unchanged; manifest: ${manifestPath}`);
}
