import { analyzeDraft, convertDraft, planStatus, tidyDraft } from '@roomie/geometry';
import type { Floorplan, PlanReading } from '@roomie/schema';
import type { PlanReader, ReaderResult } from '../plan-reader/reader';

/**
 * A plan with what the reader read: its draft tidied and kept, and, when there's a scale, the
 * draft converted to meters in place of whatever was traced. The scale comes from the plan's
 * labels, unless the user set one by measuring, which wins; without either the plan waits for
 * calibration, with the draft ready to convert. A ceiling height on the plan is used unless the
 * user entered one.
 */
export function applyReading(
  plan: Floorplan & { image: NonNullable<Floorplan['image']> },
  reader: Pick<PlanReader, 'provider' | 'model' | 'promptVersion'>,
  result: ReaderResult,
): Floorplan {
  const draft = tidyDraft(result.plan, plan.image);
  const analysis = analyzeDraft(draft);
  const reading: PlanReading = {
    provider: reader.provider,
    model: reader.model,
    promptVersion: reader.promptVersion,
    durationMs: result.durationMs,
    ...(result.usage && { usage: result.usage }),
    raw: result.raw,
    draft,
    scaleCandidates: analysis.scale.status === 'ask' ? analysis.scale.candidates : [],
  };
  const fromPlan = analysis.ceiling !== undefined && plan.ceilingHeightSource !== 'user';
  const ceilingHeight = fromPlan ? analysis.ceiling! : plan.ceilingHeight;
  const measured = plan.scale && plan.scale.method !== 'labels' ? plan.scale : undefined;
  const scale = measured ?? (analysis.scale.status === 'found' ? analysis.scale.scale : undefined);
  const next: Floorplan = {
    ...plan,
    reading,
    ceilingHeight,
    ceilingHeightSource: fromPlan ? 'plan' : plan.ceilingHeightSource,
    ...(scale
      ? { ...convertDraft(draft, scale, ceilingHeight, analysis), scale }
      : { walls: [], openings: [], rooms: [], obstacles: [], labels: [], scale: null }),
  };
  return { ...next, status: planStatus(next) };
}
