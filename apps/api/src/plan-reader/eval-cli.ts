// pnpm plans:eval [--model <gemini model>] [--fresh] [plan folders...]
//
// Reads every test plan with a checked floorplan.json (fixtures/plans, and data/plans/eval for
// plans that can't be committed) and reports how close the readings are. Readings are cached by
// image, model and prompt version; --fresh reads again. Sends the images to the plan reader: on
// Gemini's free tier, only plans we own (see the README).

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Floorplan, SourceUnit } from '@roomie/schema';
import { z } from 'zod';
import { loadConfig } from '../config';
import { readImageInfo } from '../floorplans/image';
import { type EvalPlan, type EvalResult, evalPlan, formatReport, ReadingCache } from './eval';
import { geminiReader } from './gemini';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const config = loadConfig();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const model = option('--model');
const folders = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--model');

if (!config.reader) {
  console.error('Set GEMINI_API_KEY in .env to read plans (see .env.example).');
  process.exit(1);
}
const reader = geminiReader({ ...config.reader, ...(model && { model }) });
const cache = new ReadingCache(path.join(config.dataDir, 'cache', 'plan-reader'));

/** The folders under each parent, for the default set of test plans. */
async function children(parent: string): Promise<string[]> {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(parent, e.name));
}

/** A test plan from its folder, if it has an image and a checked floorplan.json. */
async function loadPlan(dir: string): Promise<EvalPlan | undefined> {
  const truthText = await readFile(path.join(dir, 'floorplan.json'), 'utf8').catch(() => undefined);
  if (!truthText) return undefined;
  for (const file of ['plan.png', 'plan.jpg', 'plan.jpeg']) {
    const bytes = await readFile(path.join(dir, file)).catch(() => undefined);
    if (!bytes) continue;
    const info = readImageInfo(new Uint8Array(bytes));
    if (!info) throw new Error(`${dir}/${file} isn't a PNG or JPEG image`);
    const meta = await readFile(path.join(dir, 'meta.json'), 'utf8').then(
      (t) => z.object({ units: SourceUnit.optional() }).parse(JSON.parse(t)),
      () => ({ units: undefined }),
    );
    return {
      name: path.basename(dir),
      image: {
        bytes: new Uint8Array(bytes),
        mimeType: info.type === 'png' ? 'image/png' : 'image/jpeg',
        width: info.width,
        height: info.height,
      },
      truth: Floorplan.parse(JSON.parse(truthText)),
      ...(meta.units && { units: meta.units }),
    };
  }
  return undefined;
}

const dirs =
  folders.length > 0
    ? folders.map((f) => path.resolve(f))
    : [
        ...(await children(path.join(root, 'fixtures', 'plans'))),
        ...(await children(path.join(config.dataDir, 'plans', 'eval'))),
      ];
const results: EvalResult[] = [];
for (const dir of dirs) {
  const plan = await loadPlan(dir);
  if (!plan) continue;
  process.stdout.write(`${plan.name}: reading with ${reader.model}… `);
  try {
    const result = await evalPlan(plan, reader, cache, { fresh: flag('--fresh') });
    results.push(result);
    console.log('done');
  } catch (e) {
    console.log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
if (results.length === 0) {
  console.error('No test plans with a plan image and a floorplan.json.');
  process.exit(1);
}
console.log(`\n${formatReport(results)}`);
const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
const out = path.join(config.dataDir, 'eval', `${stamp}-${reader.model}.json`);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(results, null, 2));
console.log(`Saved ${path.relative(root, out)}.`);
