// pnpm layouts:eval [--model <model>] [--effort <level>] [--seeds <n>] [--yes] [homes...]
//
// Furnishes each test home (the fixtures, and the eval plans as Opus read them) with fixed
// inputs, and reports validity, scores, time and cost, with a contact sheet of every home from
// above to judge against PLAN.md's quality bar. Intents are cached by what was asked, so a rerun
// costs nothing; asking for new ones is paid, so the run stops at an estimate until --yes.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLayout } from '@roomie/geometry';
import { Product } from '@roomie/schema';
import { loadConfig } from '../config';
import { ClaudeEffort, readingCost } from '../plan-reader/claude';
import { pickCandidates } from './candidates';
import { contactSheet, formatLayoutReport, type HomeResult, homeSvg, IntentCache } from './eval';
import { generateHome } from './generate';
import { claudeIntentWriter, type IntentWriter } from './intent';
import { testHomes, testInputs } from './test-homes';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const config = loadConfig();
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const withValue = ['--model', '--effort', '--seeds'];
const only = args.filter((a, i) => !a.startsWith('--') && !withValue.includes(args[i - 1]!));

if (!config.layout) {
  console.error('Set CLAUDE_API_KEY in .env to furnish homes (see .env.example).');
  process.exit(1);
}
const writer = claudeIntentWriter({
  ...config.layout,
  model: option('--model') ?? config.layout.model,
  effort: ClaudeEffort.parse(option('--effort') ?? config.layout.effort),
});
const cache = new IntentCache(path.join(config.dataDir, 'cache', 'layout-intent'));
const catalog = Product.array()
  .parse(JSON.parse(await readFile(path.join(config.dataDir, 'catalog', 'products.json'), 'utf8')))
  .filter((p) => p.status === 'active');
const products = new Map(catalog.map((p) => [p.articleNo, p]));

const homes = (await testHomes(root, config.dataDir, config.readers.claude, only)).filter(
  (h) => testInputs(h.plan).roomIds.length > 0,
);
const asked = await Promise.all(
  homes.map(async (h) => {
    const inputs = testInputs(h.plan);
    const request = { plan: h.plan, inputs, candidates: pickCandidates(h.plan, catalog, inputs) };
    return cache.has(cache.firstKey(writer, request));
  }),
);
const uncached = homes.filter((_, i) => !asked[i]);
if (uncached.length > 0 && !args.includes('--yes')) {
  // About 12k tokens in and 4k out an intent; a repair or two can double or triple it.
  const one = readingCost(writer.model, { inputTokens: 12_000, outputTokens: 4000 });
  const price =
    one === undefined ? 'an unknown amount' : `about $${(one * uncached.length).toFixed(2)}`;
  console.log(
    `${uncached.length} of ${homes.length} homes have no cached intent from ${writer.model}: ` +
      `${uncached.map((h) => h.name).join(', ')}.\nAsking costs ${price} (more with repairs). ` +
      'Run again with --yes to go ahead.',
  );
  process.exit(0);
}

const results: HomeResult[] = [];
for (const { name, plan } of homes) {
  const inputs = testInputs(plan);
  const before = cache.fresh.length;
  let intentMs = 0;
  // Time spent waiting on the LLM, apart from the solving.
  // Without --yes, nothing is paid for: repairs not cached are skipped.
  const cached = cache.wrap(writer, { offline: !args.includes('--yes') });
  const timed: IntentWriter = {
    ...cached,
    write: async (...a) => {
      const t = Date.now();
      const r = await cached.write(...a);
      intentMs += Date.now() - t;
      return r;
    },
    repair: async (...a) => {
      const t = Date.now();
      const r = await cached.repair(...a);
      intentMs += Date.now() - t;
      return r;
    },
  };
  const started = Date.now();
  const seeds = option('--seeds');
  process.stdout.write(`${name}… `);
  const home = await generateHome(plan, inputs, {
    writer: timed,
    catalog,
    ...(seeds && { seeds: Number(seeds) }),
  });
  const fresh = cache.fresh.length > before;
  const result: HomeResult = {
    name,
    rooms: inputs.roomIds.length,
    items: home.winner.placements.length,
    problems: validateLayout(plan, home.winner.placements, products).length,
    score: home.winner.score,
    repairs: home.repairs,
    leftOut: home.rooms.flatMap((r) => r.reasons ?? []),
    intentSeconds: intentMs / 1000,
    solveSeconds: (Date.now() - started - intentMs) / 1000,
    costUsd: home.model === null ? 0 : readingCost(home.model, home.usage),
    cached: !fresh,
    svg: homeSvg(plan, home.winner.placements, products),
  };
  results.push(result);
  console.log(`${result.items} items, score ${result.score.toFixed(2)}`);
}

console.log(`\n${formatLayoutReport(results)}`);
if (cache.skipped > 0) {
  console.log(`${cache.skipped} repairs weren't cached and were skipped: --yes asks for them.`);
}
const out = path.join(config.dataDir, 'eval');
await mkdir(out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = path.join(out, `layouts-${stamp}-${writer.model}`);
// The pictures go in the contact sheet, not the JSON.
const rows = results.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'svg')));
await writeFile(`${base}.json`, JSON.stringify(rows, null, 2));
await writeFile(`${base}.html`, contactSheet(results, `Furnished test homes · ${writer.model}`));
console.log(
  `Saved ${path.relative(root, base)}.json, and the contact sheet ` +
    `${path.relative(root, base)}.html.`,
);
