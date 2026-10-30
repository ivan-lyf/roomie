import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { FURNISHABLE, Floorplan, type GenerationInputs } from '@roomie/schema';
import type { ClaudeReaderConfig } from '../config';
import { readImageInfo } from '../floorplans/image';
import { ReadingCache } from '../plan-reader/cache';
import { claudeReader } from '../plan-reader/claude';
import { emptyPlan } from '../plan-reader/eval';
import { applyReading } from '../floorplans/reading';

// The test homes `layouts:eval` furnishes and `ratings:pool` adds to rate (PLAN.md M4, M7): the
// fixtures, and each eval plan as Opus 5.5 read it.

export type TestHome = { name: string; plan: Floorplan };

/**
 * The fixtures, and each eval plan under `dataDir/plans/eval` as Opus read it, from the plan
 * reader's cache: nothing is read afresh. Without a Claude key, only the fixtures. Plans with
 * no scale are left out. With names, only those homes.
 */
export async function testHomes(
  root: string,
  dataDir: string,
  claude: ClaudeReaderConfig | undefined,
  only: readonly string[] = [],
): Promise<TestHome[]> {
  const homes: TestHome[] = [];
  const dirs = async (parent: string) =>
    (await readdir(parent, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory())
      .map((e) => path.join(parent, e.name));
  for (const dir of await dirs(path.join(root, 'fixtures', 'plans'))) {
    const json = await readFile(path.join(dir, 'floorplan.json'), 'utf8').catch(() => undefined);
    if (json) homes.push({ name: path.basename(dir), plan: Floorplan.parse(JSON.parse(json)) });
  }
  const opus = claude && claudeReader({ ...claude, model: 'claude-opus-5-5' });
  const readings = new ReadingCache(path.join(dataDir, 'cache', 'plan-reader'));
  for (const dir of opus ? await dirs(path.join(dataDir, 'plans', 'eval')) : []) {
    const bytes = await readFile(path.join(dir, 'plan.png')).catch(() => undefined);
    const info = bytes && readImageInfo(new Uint8Array(bytes));
    if (!bytes || !info) continue;
    const image = {
      bytes: new Uint8Array(bytes),
      mimeType: 'image/png' as const,
      width: info.width,
      height: info.height,
    };
    const reading = await readings.get(image, opus!);
    if (!reading) continue;
    const name = path.basename(dir);
    const blank = {
      ...emptyPlan(name),
      image: { key: name, width: info.width, height: info.height },
    };
    const plan = applyReading(blank, opus!, reading);
    if (plan.scale) homes.push({ name, plan });
  }
  return homes.filter((h) => only.length === 0 || only.includes(h.name));
}

/** The same request for every run: each room that gets furniture, $1,200 a room, one style. */
export function testInputs(plan: Floorplan): GenerationInputs {
  const roomIds = plan.rooms
    .filter((r) => r.furnishable && FURNISHABLE.has(r.roomType))
    .map((r) => r.id);
  return { roomIds, budgetCad: 1200 * roomIds.length, style: 'scandinavian', mustHaves: {} };
}
