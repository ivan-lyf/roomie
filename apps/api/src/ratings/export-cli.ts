// pnpm ratings:export
//
// The ratings as training data for ml/ (PLAN.md M7): data/ml/ratings.csv, one row per active
// rating with both rooms' features by today's scorer, and data/ml/notes.jsonl, the notes as
// written with how they were read. Then `cd ml && uv run python fit_weights.py`.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config';
import { createDb } from '../db/client';
import { exportRow, loadRated, noteLine, toCsv } from './export';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const rated = await loadRated(db);
const out = path.join(config.dataDir, 'ml');
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'ratings.csv'), toCsv(rated.map(exportRow)));
await writeFile(path.join(out, 'notes.jsonl'), rated.map((r) => `${noteLine(r)}\n`).join(''));
const decided = rated.filter((r) => r.rating.winner !== 'same').length;
const notes = rated.filter((r) => r.rating.note || r.rating.itemNotes.length > 0).length;
console.log(
  `${rated.length} ratings (${decided} with a winner, ${notes} with notes) to ` +
    `${path.relative(process.cwd(), out)}/ratings.csv and notes.jsonl.`,
);
await db.$client.end();
