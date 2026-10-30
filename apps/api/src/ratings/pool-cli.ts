// pnpm ratings:pool [--seeds <n>] [--models <a,b>] [homes...]
//
// The pool of layouts to rate on /admin/rate (PLAN.md M7): adds each test home to the database
// once, then furnishes it from the intents `layouts:eval` cached, Haiku's and Opus's, with seeds
// it hasn't tried yet, and logs every candidate as a furnishing does. Nothing is asked of the
// LLM, so it costs nothing: a home with no cached intent from a model is skipped.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Product } from '@roomie/schema';
import { DEFAULT_LAYOUT_MODEL, loadConfig } from '../config';
import { createDb } from '../db/client';
import { IntentCache } from '../layouts/eval';
import { generateHome } from '../layouts/generate';
import { type IntentWriter, LAYOUT_INTENT_PROMPT } from '../layouts/intent';
import { logGeneration } from '../layouts/log';
import { testHomes, testInputs } from '../layouts/test-homes';
import { nextSeed, testHomePlan } from './pool';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const config = loadConfig();
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const withValue = ['--seeds', '--models'];
const only = args.filter((a, i) => !a.startsWith('--') && !withValue.includes(args[i - 1]!));
const seeds = Number(option('--seeds') ?? 12);
const models = (option('--models') ?? `${DEFAULT_LAYOUT_MODEL},claude-opus-5-5`).split(',');

const db = createDb(config.databaseUrl);
const cache = new IntentCache(path.join(config.dataDir, 'cache', 'layout-intent'));
// The catalog `layouts:eval` asked from, so the cached intents are found.
const catalog = Product.array()
  .parse(JSON.parse(await readFile(path.join(config.dataDir, 'catalog', 'products.json'), 'utf8')))
  .filter((p) => p.status === 'active');

/** A writer that only answers from the cache: asking anything new is off. */
const cachedOnly = (model: string): IntentWriter =>
  cache.wrap(
    {
      model,
      promptVersion: LAYOUT_INTENT_PROMPT.version,
      write: () => Promise.reject(new Error('not cached')),
      repair: () => Promise.reject(new Error('not cached')),
    },
    { offline: true },
  );

const homes = (await testHomes(root, config.dataDir, config.readers.claude, only)).filter(
  (h) => testInputs(h.plan).roomIds.length > 0,
);
let added = 0;
let logged = 0;
for (const home of homes) {
  const saved = await testHomePlan(db, home);
  if (!saved) {
    console.log(`${home.name}: its plan was read differently since it was added; skipped.`);
    continue;
  }
  if (saved.added) added++;
  const { plan } = saved;
  const inputs = testInputs(plan);
  for (const model of models) {
    const firstSeed = await nextSeed(db, plan.id, model);
    process.stdout.write(`${home.name}, ${model}, seeds ${firstSeed}–${firstSeed + seeds - 1}… `);
    let generation;
    try {
      generation = await generateHome(plan, inputs, {
        writer: cachedOnly(model),
        catalog,
        seeds,
        firstSeed,
      });
    } catch (e) {
      console.log(e instanceof Error && /No cached intent/.test(e.message) ? 'no intent' : e);
      continue;
    }
    await logGeneration(db, plan.id, randomUUID(), inputs, generation);
    logged += generation.candidates.length + 1;
    console.log(`${inputs.roomIds.length} rooms, ${generation.candidates.length} layouts`);
  }
}
console.log(
  `\n${homes.length} test homes (${added} added to the database), ${logged} layouts logged. ` +
    `${cache.skipped} repairs weren't cached and kept the intent as it was.`,
);
await db.$client.end();
