import type { LlmRoute } from '@roomie/schema';
import type { Account } from './auth';
import type { Db } from './db/client';
import { usage } from './db/schema';
import { readingCost } from './plan-reader/claude';
import type { ReaderUsage } from './plan-reader/reader';

// What each request that calls an LLM used and cost (PLAN.md M6): the daily allowance is
// counted from it, and nothing in it is ever deleted.

/** What one request used: every call it made, or nothing when its answer came from a cache. */
export type Spent = {
  /** The model that answered; none when nothing was asked. */
  model: string | null;
  usage: ReaderUsage;
  cached?: boolean;
  failed?: boolean;
};

/** In US dollars: nothing when cached, and null when the model's price isn't known. */
export function costOf({ model, usage: used, cached }: Spent): number | null {
  if (cached) return 0;
  if (model === null) return used.inputTokens + used.outputTokens === 0 ? 0 : null;
  const cost = readingCost(model, used);
  return cost === undefined ? null : Math.round(cost * 1e6) / 1e6;
}

/** Logs what a request that called an LLM used, against the account that asked. */
export async function recordUsage(
  db: Db,
  account: Account,
  route: LlmRoute,
  floorplanId: string | null,
  spent: Spent,
): Promise<void> {
  await db.insert(usage).values({
    accountId: account.id,
    route,
    floorplanId,
    model: spent.cached ? null : spent.model,
    inputTokens: spent.cached ? 0 : spent.usage.inputTokens,
    outputTokens: spent.cached ? 0 : spent.usage.outputTokens,
    costUsd: costOf(spent),
    cached: spent.cached ?? false,
    status: spent.failed ? 'failed' : 'done',
  });
}
