// pnpm ratings:lessons [--model <model>] [--yes]
//
// Lessons from the rating notes (PLAN.md M7): reads data/ml/notes.jsonl (`pnpm ratings:export`
// writes it), sends every note and how it was read, text only, to the layout model, and writes
// the lessons it proposes to data/ml/lessons.md, to keep, edit or drop, and lessons.json. Paid:
// it stops at an estimate until --yes.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config';
import { readingCost } from '../plan-reader/claude';
import { lessonsMarkdown, lessonsMessage, type NoteLine, proposeLessons } from './lessons';

const config = loadConfig();
const args = process.argv.slice(2);
const model = args.includes('--model') ? args[args.indexOf('--model') + 1]! : undefined;
if (!config.layout) {
  console.error('Set CLAUDE_API_KEY in .env (see .env.example).');
  process.exit(1);
}
const options = { ...config.layout, ...(model && { model }) };
const dir = path.join(config.dataDir, 'ml');
const text = await readFile(path.join(dir, 'notes.jsonl'), 'utf8').catch(() => '');
const notes = text
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as NoteLine)
  .filter((n) => n.note || n.itemNotes.some((i) => i.note.trim() !== ''));
if (notes.length === 0) {
  console.log('No notes to learn from: rate with notes, then `pnpm ratings:export`.');
  process.exit(0);
}
// About four characters a token; the answer, a few thousand tokens with the model's reasoning.
const inputTokens = Math.ceil(lessonsMessage(notes).length / 4);
const cost = readingCost(options.model, { inputTokens, outputTokens: 4000 });
if (!args.includes('--yes')) {
  const price = cost === undefined ? 'an unknown amount' : `about $${cost.toFixed(3)}`;
  console.log(
    `${notes.length} notes, about ${inputTokens} tokens, to ${options.model}: ${price}. ` +
      'Run again with --yes to go ahead.',
  );
  process.exit(0);
}
const { lessons, usage } = await proposeLessons(notes, options);
const day = new Date().toISOString().slice(0, 10);
await writeFile(path.join(dir, 'lessons.json'), JSON.stringify(lessons, null, 2) + '\n');
await writeFile(path.join(dir, 'lessons.md'), lessonsMarkdown(lessons, notes.length, day));
console.log(lessonsMarkdown(lessons, notes.length, day));
const paid = readingCost(options.model, usage);
console.log(
  `${options.model}: ${usage.inputTokens} tokens in, ${usage.outputTokens} out` +
    (paid === undefined ? '.' : `, $${paid.toFixed(3)}.`) +
    ' Written to data/ml/lessons.md and lessons.json.',
);
