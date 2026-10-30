import type { GenerationInputs, LoggedIntent } from '@roomie/schema';
import type { Db } from '../db/client';
import { layouts } from '../db/schema';
import type { Generation } from './generate';

/**
 * Logs a generation: the winner, then every candidate, as layouts of the floorplan (CLAUDE.md:
 * every candidate, not only the winner). Answers the winner's id.
 */
export async function logGeneration(
  db: Db,
  floorplanId: string,
  generationId: string,
  inputs: GenerationInputs,
  home: Generation,
): Promise<string> {
  const llmIntent: LoggedIntent = {
    intent: home.intent,
    mode: home.mode,
    model: home.model,
    usage: home.usage,
    repairs: home.repairs,
    seeds: home.seeds,
    ...(home.parent && { parent: home.parent }),
  };
  const row = (candidate: Generation['winner'], status: 'candidate' | 'winner') => ({
    floorplanId,
    generationId,
    inputs,
    placements: candidate.placements,
    score: candidate.score,
    scoreBreakdown: candidate.breakdown,
    llmIntent,
    promptVersion: home.promptVersion,
    status,
  });
  const [winner] = await db.insert(layouts).values(row(home.winner, 'winner')).returning();
  if (home.candidates.length > 0) {
    await db.insert(layouts).values(home.candidates.map((c) => row(c, 'candidate')));
  }
  return winner!.id;
}
