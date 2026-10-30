// pnpm ratings:pool [--seeds <n>] [--models <a,b>] [--compare <weights.json> [--label <name>]]
//                   [homes...]
//
// The pool of layouts to rate on /admin/rate (PLAN.md M7): adds each test home to the database
// once, then furnishes it from the intents `layouts:eval` cached, Haiku's and Opus's, with seeds
// it hasn't tried yet, and logs every candidate as a furnishing does. Nothing is asked of the
// LLM, so it costs nothing: a home with no cached intent from a model is skipped.
//
// With --compare, for the blind check of weights fitted to ratings: each home is furnished twice
// from the same intent and seeds, once by the current weights and once by those in the file,
// each logged under its weights' name ("current", and the file's name or --label), to rate at
// /admin/rate?compare=<name>.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOM_FEATURES, ROOM_WEIGHTS } from '@roomie/geometry';
import { Product } from '@roomie/schema';
import { z } from 'zod';
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
const withValue = ['--seeds', '--models', '--compare', '--label'];
const only = args.filter((a, i) => !a.startsWith('--') && !withValue.includes(args[i - 1]!));
const compareFile = option('--compare');
const seeds = Number(option('--seeds') ?? (compareFile ? 8 : 12));
const models = (
  option('--models') ??
  (compareFile ? DEFAULT_LAYOUT_MODEL : `${DEFAULT_LAYOUT_MODEL},claude-opus-5-5`)
).split(',');

/** The weight sets to furnish by: weights.json's alone, or it against the file's. */
const weightSets = await (async () => {
  if (!compareFile) return [undefined];
  const file = z
    .object({ room: z.record(z.string(), z.number().nonnegative()) })
    .parse(JSON.parse(await readFile(compareFile, 'utf8')));
  const missing = ROOM_FEATURES.filter((f) => !(f in file.room));
  if (missing.length > 0) throw new Error(`${compareFile} has no weight for ${missing.join(', ')}`);
  const name = option('--label') ?? path.basename(compareFile, '.json');
  if (name === 'current')
    throw new Error('Name the weights compared something other than current.');
  return [
    { name: 'current', room: ROOM_WEIGHTS },
    { name, room: file.room },
  ];
})();

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
    for (const weights of weightSets) {
      const by = weights ? `, ${weights.name} weights` : '';
      process.stdout.write(
        `${home.name}, ${model}${by}, seeds ${firstSeed}–${firstSeed + seeds - 1}… `,
      );
      let generation;
      try {
        generation = await generateHome(plan, inputs, {
          writer: cachedOnly(model),
          catalog,
          seeds,
          firstSeed,
          ...(weights && { weights }),
        });
      } catch (e) {
        console.log(e instanceof Error && /No cached intent/.test(e.message) ? 'no intent' : e);
        break;
      }
      await logGeneration(db, plan.id, randomUUID(), inputs, generation);
      logged += generation.candidates.length + 1;
      console.log(`${inputs.roomIds.length} rooms, ${generation.candidates.length} layouts`);
    }
  }
}
console.log(
  `\n${homes.length} test homes (${added} added to the database), ${logged} layouts logged. ` +
    `${cache.skipped} repairs weren't cached and kept the intent as it was.`,
);
await db.$client.end();
