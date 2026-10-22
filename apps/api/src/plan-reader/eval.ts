import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  analyzeDraft,
  comparePlans,
  convertDraft,
  type PlanComparison,
  tidyDraft,
  validateFloorplan,
} from '@roomie/geometry';
import type { Floorplan, SourceUnit } from '@roomie/schema';
import type { PlanImage, PlanReader, ReaderResult } from './reader';

// The plan reader's eval (PLAN.md §6, M2): read every test plan that has a checked
// `floorplan.json`, and measure the reading against it.

export type EvalPlan = {
  name: string;
  image: PlanImage;
  truth: Floorplan;
  /** The unit the plan's labels are in (its meta.json), for unit detection. */
  units?: SourceUnit;
};

export type EvalResult = {
  name: string;
  model: string;
  promptVersion: string;
  cached: boolean;
  durationMs: number;
  usage?: ReaderResult['usage'];
  scale: {
    status: 'found' | 'ask' | 'none';
    unit?: SourceUnit;
    expectedUnit?: SourceUnit;
    /** How far the scale found is from the true one, as a fraction. */
    error?: number;
  };
  /** The reading converted at the true scale, so the geometry is judged apart from the scale. */
  geometry: PlanComparison;
  /** What `validateFloorplan` finds in the plan the app would make from the reading. */
  problems: string[];
};

/** Answers already read, by image, model and prompt version: re-runs cost nothing. */
export class ReadingCache {
  constructor(private readonly dir: string) {}

  private file(image: PlanImage, reader: PlanReader) {
    const hash = createHash('sha256').update(image.bytes).digest('hex').slice(0, 16);
    return path.join(this.dir, `${hash}-${reader.model}-${reader.promptVersion}.json`);
  }

  async get(image: PlanImage, reader: PlanReader): Promise<ReaderResult | undefined> {
    const text = await readFile(this.file(image, reader), 'utf8').catch(() => undefined);
    if (!text) return undefined;
    const saved = JSON.parse(text) as Omit<ReaderResult, 'plan'>;
    return { ...saved, plan: reader.planFromRaw(saved.raw, image) };
  }

  async put(image: PlanImage, reader: PlanReader, result: ReaderResult): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const { raw, usage, durationMs } = result;
    await writeFile(this.file(image, reader), JSON.stringify({ raw, usage, durationMs }));
  }
}

/**
 * Reads one test plan, or takes its cached reading unless `fresh`, and measures the reading
 * against the plan's truth.
 */
export async function evalPlan(
  plan: EvalPlan,
  reader: PlanReader,
  cache?: ReadingCache,
  { fresh = false } = {},
): Promise<EvalResult> {
  const hit = fresh ? undefined : await cache?.get(plan.image, reader);
  const result = hit ?? (await reader.read(plan.image));
  if (!hit) await cache?.put(plan.image, reader, result);

  const draft = tidyDraft(result.plan, plan.image);
  const analysis = analyzeDraft(draft);
  const truthScale = plan.truth.scale;
  if (!truthScale) throw new Error(`${plan.name}: its floorplan.json has no scale`);
  const found = analysis.scale.status === 'found' ? analysis.scale.scale : undefined;

  const atTrueScale = convertDraft(draft, truthScale, plan.truth.ceilingHeight, analysis);
  const made = found ?? truthScale;
  const app = {
    ...plan.truth,
    ...convertDraft(draft, made, plan.truth.ceilingHeight, analysis),
    scale: made,
  };
  return {
    name: plan.name,
    model: reader.model,
    promptVersion: reader.promptVersion,
    cached: Boolean(hit),
    durationMs: result.durationMs,
    ...(result.usage && { usage: result.usage }),
    scale: {
      status: analysis.scale.status,
      ...(found && {
        unit: found.sourceUnit,
        error: found.metersPerPixel / truthScale.metersPerPixel - 1,
      }),
      ...(plan.units && { expectedUnit: plan.units }),
    },
    geometry: comparePlans(plan.truth, { ...plan.truth, ...atTrueScale }),
    problems: validateFloorplan(app).map((p) => p.code),
  };
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/** The results as a table, with totals against PLAN.md's goals. */
export function formatReport(results: readonly EvalResult[]): string {
  const rows = results.map((r) => {
    const g = r.geometry;
    // A unit other than the plan's meta.json says is marked with "!".
    const wrongUnit = r.scale.expectedUnit && r.scale.unit !== r.scale.expectedUnit ? '!' : '';
    const scale =
      r.scale.status === 'found'
        ? `${r.scale.unit}${wrongUnit} ` +
          `${r.scale.error! >= 0 ? '+' : ''}${(r.scale.error! * 100).toFixed(1)}%`
        : r.scale.status;
    return [
      r.name,
      `${Math.round(r.durationMs / 1000)} s${r.cached ? '*' : ''}`,
      r.usage ? `${r.usage.inputTokens}/${r.usage.outputTokens}` : '',
      scale,
      `${pct(g.walls.recall)}/${pct(g.walls.precision)}`,
      `${pct(g.openings.recall)}/${pct(g.openings.precision)}`,
      `${g.doors.swingRight}/${g.doors.matched}`,
      `${g.rooms.typed}/${g.rooms.truth}`,
      r.problems.join(' ') || 'none',
    ];
  });
  const header = [
    'plan',
    'time',
    'tokens in/out',
    'scale',
    'walls R/P',
    'openings R/P',
    'swings',
    'rooms typed',
    'problems',
  ];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd();

  const rooms = results.reduce((s, r) => s + r.geometry.rooms.truth, 0);
  const typed = results.reduce((s, r) => s + r.geometry.rooms.typed, 0);
  const scaled = results.filter((r) => r.scale.error !== undefined);
  const within = scaled.filter((r) => Math.abs(r.scale.error!) <= 0.03).length;
  return [
    line(header),
    ...rows.map(line),
    '',
    `Room types right: ${typed}/${rooms} (goal ≥ 90%). ` +
      `Scale within 3%: ${within}/${results.length} plans. * = cached reading.`,
  ].join('\n');
}
