// pnpm plans:eval [--provider gemini|claude] [--model <model>] [--effort <level>] [--batch]
//                 [--fresh] [plan folders...]
//
// Reads every test plan (fixtures/plans, and data/plans/eval for plans that can't be
// committed) that has a checked floorplan.json or a truth.json, and reports how close the
// readings are. Readings are cached by image, model and prompt version; --fresh reads again.
// This sends the images to Gemini (on its free tier Google may use them) or to Claude (paid per
// read; --batch reads every plan not yet cached in one batch, at half price), so only plans
// you're happy to share (see the README).

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Floorplan, SourceUnit } from '@roomie/schema';
import { z } from 'zod';
import { loadConfig } from '../config';
import { readImageInfo } from '../floorplans/image';
import { type EvalPlan, type EvalResult, evalPlan, formatReport, LabelTruth } from './eval';
import { imageId, ReadingCache } from './cache';
import { ClaudeEffort, claudeBatch, claudeReader, readingCost } from './claude';
import { geminiReader } from './gemini';
import { ReaderError } from './reader';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const config = loadConfig();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const withValue = ['--provider', '--model', '--effort'];
const folders = args.filter((a, i) => !a.startsWith('--') && !withValue.includes(args[i - 1]!));
const provider = option('--provider') ?? config.reader?.provider ?? 'gemini';
const model = option('--model');
const batch = flag('--batch');

const claude = provider === 'claude' ? config.readers.claude : undefined;
const gemini = provider === 'gemini' ? config.readers.gemini : undefined;
if (!claude && !gemini) {
  const key = provider === 'claude' ? 'CLAUDE_API_KEY' : 'GEMINI_API_KEY';
  console.error(`Set ${key} in .env to read plans with ${provider} (see .env.example).`);
  process.exit(1);
}
if (batch && !claude) {
  console.error('--batch reads with Claude: add --provider claude.');
  process.exit(1);
}
const claudeOptions = claude && {
  ...claude,
  model: model ?? claude.model,
  effort: ClaudeEffort.parse(option('--effort') ?? claude.effort),
};
// One model at a time, so each reading is that model's.
const reader = claudeOptions
  ? claudeReader(claudeOptions)
  : geminiReader({ ...gemini!, models: [model ?? gemini!.models[0]!] });
const cache = new ReadingCache(path.join(config.dataDir, 'cache', 'plan-reader'));
/** Dollars spent on readings in this run, when the model's price is known. */
let spent = 0;

/** The folders under each parent, for the default set of test plans. */
async function children(parent: string): Promise<string[]> {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(parent, e.name));
}

/**
 * A test plan from its folder: its image, and a checked floorplan.json or a truth.json (its true
 * scale and the rooms its labels name).
 */
async function loadPlan(dir: string): Promise<EvalPlan | undefined> {
  const read = (file: string) => readFile(path.join(dir, file), 'utf8').catch(() => undefined);
  const floorplan = await read('floorplan.json');
  const labels = floorplan ? undefined : await read('truth.json');
  if (!floorplan && !labels) return undefined;
  for (const file of ['plan.png', 'plan.jpg', 'plan.jpeg']) {
    const bytes = await readFile(path.join(dir, file)).catch(() => undefined);
    if (!bytes) continue;
    const info = readImageInfo(new Uint8Array(bytes));
    if (!info) throw new Error(`${dir}/${file} isn't a PNG or JPEG image`);
    const meta = await read('meta.json').then((t) =>
      t ? z.object({ units: SourceUnit.optional() }).parse(JSON.parse(t)) : { units: undefined },
    );
    return {
      name: path.basename(dir),
      image: {
        bytes: new Uint8Array(bytes),
        mimeType: info.type === 'png' ? 'image/png' : 'image/jpeg',
        width: info.width,
        height: info.height,
      },
      ...(floorplan
        ? { floorplan: Floorplan.parse(JSON.parse(floorplan)) }
        : { labels: LabelTruth.parse(JSON.parse(labels!)) }),
      ...(meta.units && { units: meta.units }),
    };
  }
  return undefined;
}

// Folders given are relative to where pnpm was run, not to this package.
const cwd = process.env['INIT_CWD'] ?? process.cwd();
const dirs =
  folders.length > 0
    ? folders.map((f) => path.resolve(cwd, f))
    : [
        ...(await children(path.join(root, 'fixtures', 'plans'))),
        ...(await children(path.join(config.dataDir, 'plans', 'eval'))),
      ];
const plans = (await Promise.all(dirs.map(loadPlan))).filter((p) => p !== undefined);

// A batch first reads every plan not cached yet; the loop below then scores them from the cache.
const failed = new Set<string>();
if (batch && claudeOptions) {
  const unread = [];
  for (const plan of plans) {
    if (flag('--fresh') || !(await cache.get(plan.image, reader))) unread.push(plan);
  }
  if (unread.length > 0) {
    console.log(`Reading ${unread.length} plans in one batch with ${reader.model}…`);
    const read = await claudeBatch(
      { ...claudeOptions, onStatus: (status) => console.log(`  ${status}`) },
      unread.map((plan) => ({ id: imageId(plan.image), image: plan.image })),
    );
    for (const plan of unread) {
      const result = read.get(imageId(plan.image));
      if (result && !(result instanceof ReaderError)) {
        await cache.put(plan.image, reader, result);
        spent += (result.usage && readingCost(reader.model, result.usage, true)) ?? 0;
      } else {
        failed.add(plan.name);
        console.log(`${plan.name}: failed: ${result?.message ?? 'no result'}`);
      }
    }
  }
}

const results: EvalResult[] = [];
for (const plan of plans) {
  if (failed.has(plan.name)) continue;
  process.stdout.write(`${plan.name}: reading with ${reader.model}… `);
  try {
    const fresh = flag('--fresh') && !batch;
    const result = await evalPlan(plan, reader, cache, { fresh });
    results.push(result);
    if (!result.cached && result.usage) spent += readingCost(reader.model, result.usage) ?? 0;
    console.log('done');
  } catch (e) {
    console.log(`failed: ${e instanceof Error ? e.message : String(e)}`);
    // Out of quota (or rate limited): the rest would fail the same way.
    if (e instanceof ReaderError && e.status === 429) break;
  }
}
if (results.length === 0) {
  console.error('No test plans with a plan image and a floorplan.json or truth.json.');
  process.exit(1);
}
console.log(`\n${formatReport(results)}`);
if (provider === 'claude') console.log(`Spent on readings this run: $${spent.toFixed(2)}.`);
const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
const out = path.join(config.dataDir, 'eval', `${stamp}-${reader.model}.json`);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(results, null, 2));
console.log(`Saved ${path.relative(root, out)}.`);
