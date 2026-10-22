import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  analyzeDraft,
  area,
  comparePlans,
  convertDraft,
  type DraftAnalysis,
  DEFAULT_CEILING_HEIGHT,
  labelTokens,
  median,
  type PlanComparison,
  tidyDraft,
  validateFloorplan,
} from '@roomie/geometry';
import {
  type Floorplan,
  type PlanDraft,
  RoomType,
  type Scale,
  type SourceUnit,
  type Vec2,
} from '@roomie/schema';
import { z } from 'zod';
import type { PlanImage, PlanReader, ReaderResult } from './reader';

// The plan reader's eval (PLAN.md §6, M2): read every test plan and measure the reading against
// what's known about it. Plans drawn for the repo have a checked `floorplan.json`; plans from
// elsewhere have a `truth.json` with their true scale and the rooms their labels name.

/**
 * What's known about a plan without a checked floorplan.json: its true scale in the image's
 * pixels (null when its own labels disagree with its drawing), and the rooms its labels name.
 */
export const LabelTruth = z.object({
  metersPerPixel: z.number().positive().nullable(),
  /** How the scale is known, e.g. "A4 at 300 dpi, drawn at 1:100". */
  scaleSource: z.string(),
  ceilingHeight: z.number().positive().optional(),
  rooms: z
    .array(
      z.object({
        /** As printed, e.g. "CHAMBRE 2"; matched word for word against the reading's text. */
        label: z.string().min(1),
        type: RoomType,
        /** The printed area, inside the walls. */
        squareMeters: z.number().positive().optional(),
        /** Other labels in the same open space, which the printed area covers too. */
        with: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});
export type LabelTruth = z.infer<typeof LabelTruth>;

export type EvalPlan = {
  name: string;
  image: PlanImage;
  /** The unit the plan's labels are in (its meta.json), for unit detection. */
  units?: SourceUnit;
} & ({ floorplan: Floorplan } | { labels: LabelTruth });

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
    /** How far the scale found is from the true one, as a fraction, when that's known. */
    error?: number;
  };
  /** Against a checked floorplan, at its true scale, so geometry is judged apart from scale. */
  geometry?: PlanComparison;
  rooms: {
    /** Rooms the truth names. */
    named: number;
    /** …found in the reading, by their label or their outline. */
    found: number;
    /** …with the right type: the ≥ 90% goal. */
    typed: number;
    /** Rooms with a printed area, and how many of them the reading draws within 15%. */
    areas?: { checked: number; within: number };
  };
  ceiling?: { expected: number; found?: number };
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

function perimeter(points: readonly Vec2[]): number {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]!;
    return sum + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);
}

/** Printed areas are inside the walls: shrink an outline on the walls' centers by half a wall. */
const insideArea = (points: readonly Vec2[], thickness: number) =>
  area(points) - (perimeter(points) * thickness) / 2 + thickness * thickness;

/**
 * Checks a reading against the rooms a plan's labels name: a room is found when a read room
 * holds every word of its label, typed when that room has its type, and its size is right when
 * the read rooms holding it (and the labels in the same open space) come within 15% of the
 * printed area, inside the walls.
 */
export function scoreLabels(
  draft: PlanDraft,
  analysis: DraftAnalysis,
  truth: LabelTruth,
): EvalResult['rooms'] {
  const texts = new Map(draft.texts.map((t) => [t.id, t.text]));
  const words = new Map(
    draft.rooms.map((r) => [
      r.id,
      new Set(analysis.rooms.get(r.id)!.textIds.flatMap((id) => labelTokens(texts.get(id)!))),
    ]),
  );
  const holding = (label: string) => {
    const want = labelTokens(label);
    return draft.rooms.filter((r) => want.every((w) => words.get(r.id)!.has(w)));
  };
  const mpp = truth.metersPerPixel;
  const thickness = draft.walls.length > 0 ? median(draft.walls.map((w) => w.thickness)) : 0;
  let [found, typed, checked, within] = [0, 0, 0, 0];
  for (const room of truth.rooms) {
    const holders = holding(room.label);
    if (holders.length === 0) continue;
    found++;
    if (holders.some((r) => analysis.rooms.get(r.id)!.type === room.type)) typed++;
    if (room.squareMeters === undefined || mpp === null) continue;
    checked++;
    const group = new Set([room.label, ...room.with].flatMap(holding));
    const pixels = [...group].reduce((sum, r) => sum + insideArea(r.polygon, thickness), 0);
    if (Math.abs((pixels * mpp * mpp) / room.squareMeters - 1) <= 0.15) within++;
  }
  return {
    named: truth.rooms.length,
    found,
    typed,
    ...(mpp !== null && { areas: { checked, within } }),
  };
}

/**
 * Reads one test plan, or takes its cached reading unless `fresh`, and measures the reading
 * against what's known about the plan.
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
  const found = analysis.scale.status === 'found' ? analysis.scale.scale : undefined;
  const trueScale: Pick<Scale, 'metersPerPixel' | 'sourceUnit'> | undefined =
    'floorplan' in plan
      ? (plan.floorplan.scale ?? undefined)
      : plan.labels.metersPerPixel === null
        ? undefined
        : { metersPerPixel: plan.labels.metersPerPixel, sourceUnit: plan.units ?? 'none' };
  const ceiling =
    'floorplan' in plan
      ? plan.floorplan.ceilingHeight
      : (plan.labels.ceilingHeight ?? DEFAULT_CEILING_HEIGHT);

  // The plan the app would make: at the scale found, else (as after calibrating) the true one.
  const made = found ?? trueScale;
  const problems = made
    ? validateFloorplan({
        ...('floorplan' in plan ? plan.floorplan : emptyPlan(plan.name)),
        ...convertDraft(draft, made, ceiling, analysis),
        scale: { method: 'labels', inputs: {}, residual: 0, ...made },
      }).map((p) => p.code)
    : ['no_scale'];

  let geometry: PlanComparison | undefined;
  let rooms: EvalResult['rooms'];
  if ('floorplan' in plan) {
    const truth = plan.floorplan;
    const atTrueScale = convertDraft(draft, truth.scale!, ceiling, analysis);
    geometry = comparePlans(truth, { ...truth, ...atTrueScale });
    rooms = {
      named: geometry.rooms.truth,
      found: geometry.rooms.matched,
      typed: geometry.rooms.typed,
    };
  } else {
    rooms = scoreLabels(draft, analysis, plan.labels);
  }

  return {
    name: plan.name,
    model: result.model ?? reader.model,
    promptVersion: reader.promptVersion,
    cached: Boolean(hit),
    durationMs: result.durationMs,
    ...(result.usage && { usage: result.usage }),
    scale: {
      status: analysis.scale.status,
      ...(found && { unit: found.sourceUnit }),
      ...(found && trueScale && { error: found.metersPerPixel / trueScale.metersPerPixel - 1 }),
      ...(plan.units && { expectedUnit: plan.units }),
    },
    ...(geometry && { geometry }),
    rooms,
    ...('labels' in plan &&
      plan.labels.ceilingHeight !== undefined && {
        ceiling: {
          expected: plan.labels.ceilingHeight,
          ...(analysis.ceiling !== undefined && { found: analysis.ceiling }),
        },
      }),
    problems,
  };
}

/** A floorplan to hold a reading of a plan that only has a truth.json. */
function emptyPlan(name: string): Floorplan {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    name,
    status: 'uploaded',
    image: null,
    walls: [],
    openings: [],
    rooms: [],
    obstacles: [],
    labels: [],
    scale: null,
    ceilingHeight: DEFAULT_CEILING_HEIGHT,
    ceilingHeightSource: 'default',
    materials: {
      wallColor: '#f3efe7',
      floor: 'light_oak',
      light: { warmthK: 3000, intensity: 0.7 },
    },
    reading: null,
    editSeconds: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/** The results as a table, with totals against PLAN.md's goals. */
export function formatReport(results: readonly EvalResult[]): string {
  const rows = results.map((r) => {
    const g = r.geometry;
    // A unit other than the plan's meta.json says is marked with "!".
    const wrongUnit = r.scale.expectedUnit && r.scale.unit !== r.scale.expectedUnit ? '!' : '';
    const error =
      r.scale.error === undefined
        ? ''
        : ` ${r.scale.error >= 0 ? '+' : ''}${(r.scale.error * 100).toFixed(1)}%`;
    const scale =
      r.scale.status === 'found' ? `${r.scale.unit}${wrongUnit}${error}` : r.scale.status;
    const areas = r.rooms.areas ? `${r.rooms.areas.within}/${r.rooms.areas.checked}` : '–';
    return [
      r.name,
      `${Math.round(r.durationMs / 1000)} s${r.cached ? '*' : ''}`,
      r.usage ? `${r.usage.inputTokens}/${r.usage.outputTokens}` : '',
      scale,
      g ? `${pct(g.walls.recall)}/${pct(g.walls.precision)}` : '–',
      g ? `${pct(g.openings.recall)}/${pct(g.openings.precision)}` : '–',
      g ? `${g.doors.swingRight}/${g.doors.matched}` : '–',
      `${r.rooms.found}/${r.rooms.named}`,
      `${r.rooms.typed}/${r.rooms.named}`,
      areas,
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
    'rooms found',
    'typed',
    'areas',
    'problems',
  ];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd();

  const named = results.reduce((s, r) => s + r.rooms.named, 0);
  const typed = results.reduce((s, r) => s + r.rooms.typed, 0);
  const scaled = results.filter((r) => r.scale.error !== undefined);
  const within = scaled.filter((r) => Math.abs(r.scale.error!) <= 0.03).length;
  const known = results.filter(
    (r) => r.scale.error !== undefined || r.geometry || r.rooms.areas,
  ).length;
  return [
    line(header),
    ...rows.map(line),
    '',
    `Room types right: ${typed}/${named} (${pct(typed / Math.max(named, 1))}, goal ≥ 90%). ` +
      `Scale within 3%: ${within}/${known} plans with a known scale. * = cached reading.`,
  ].join('\n');
}
