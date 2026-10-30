import type { LlmRoute, Me, Refusal } from '@roomie/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Account } from './auth';
import type { Db } from './db/client';
import { usage } from './db/schema';
import { readingCost } from './plan-reader/claude';
import type { ReaderUsage } from './plan-reader/reader';

// The daily allowance (PLAN.md M6): what each account may spend on LLM calls a calendar day,
// counted from its usage rows, in one time zone. A request goes ahead only if one more like it
// still fits, and an account makes one at a time, so a day can't run far over.

export type AllowanceConfig = { dailyUsd: number; timeZone: string };

/** What an account has spent today: `GET /me` without whether it's an admin. */
export type Spending = Omit<Me, 'admin'>;

/** What one request usually uses, by route: about what the test homes and plans used. */
const TYPICAL: Record<LlmRoute, ReaderUsage> = {
  read_plan: { inputTokens: 6000, outputTokens: 4000 },
  furnish_home: { inputTokens: 12_000, outputTokens: 4000 },
  new_pieces: { inputTokens: 6000, outputTokens: 2500 },
  read_note: { inputTokens: 2000, outputTokens: 400 },
  revise_room: { inputTokens: 5000, outputTokens: 1500 },
};

/** What one request on this route usually costs on this model: nothing on a free one. */
export const typicalCost = (route: LlmRoute, model: string) =>
  readingCost(model, TYPICAL[route]) ?? 0;

/** A time zone's offset from UTC at an instant, in minutes: Vancouver in summer is -420. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The calendar day an instant falls on in a time zone, from its midnight to the next: 24 hours,
 * or 23 or 25 on the days daylight time starts or ends.
 */
export function dayOf(now: Date, timeZone: string): { start: Date; end: Date } {
  const local = new Date(now.getTime() + offsetMinutes(now, timeZone) * 60_000);
  const midnight = (day: number) => {
    const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), day);
    // The offset at midnight itself, which may differ from now's.
    const guess = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
    return new Date(wall - offsetMinutes(new Date(guess), timeZone) * 60_000);
  };
  return { start: midnight(local.getUTCDate()), end: midnight(local.getUTCDate() + 1) };
}

/** A refusal, with the status the API answers it with. */
export type Refused = { status: 409 | 429; refusal: Refusal };

export class Allowance {
  /** Accounts with an LLM request under way. */
  private readonly running = new Set<string>();

  constructor(
    private readonly db: Db,
    readonly config: AllowanceConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** What the account has spent today, and when that starts again from nothing. */
  async today(account: Account): Promise<Spending> {
    const { start, end } = dayOf(this.now(), this.config.timeZone);
    const [row] = await this.db
      .select({ spent: sql<string>`coalesce(sum(${usage.costUsd}), 0)` })
      .from(usage)
      .where(and(eq(usage.accountId, account.id), gte(usage.createdAt, start)));
    return {
      id: account.id,
      email: account.email,
      spentUsd: Number(row?.spent ?? 0),
      allowanceUsd: this.config.dailyUsd,
      resetsAt: end,
    };
  }

  /**
   * Lets one more request on this route and model go ahead for the account, or says why not:
   * one is under way already, or today's spend plus what one usually costs would pass the
   * allowance. A request let through holds the account until `release`.
   */
  async take(account: Account, route: LlmRoute, model: string): Promise<Refused | undefined> {
    if (this.running.has(account.id)) {
      return {
        status: 409,
        refusal: { error: 'Wait for the AI step under way to finish.', code: 'busy' },
      };
    }
    this.running.add(account.id);
    try {
      const { spentUsd, allowanceUsd, resetsAt } = await this.today(account);
      if (spentUsd >= allowanceUsd || spentUsd + typicalCost(route, model) > allowanceUsd) {
        this.running.delete(account.id);
        const allowance = `$${allowanceUsd.toFixed(2)}`;
        return {
          status: 429,
          refusal: {
            error:
              `You've used today's AI allowance (${allowance}). It's back at midnight; ` +
              'you can still edit by hand.',
            code: 'allowance_reached',
            resetsAt,
          },
        };
      }
    } catch (e) {
      this.running.delete(account.id);
      throw e;
    }
    return undefined;
  }

  /** Lets the account make another request. */
  release(account: Account) {
    this.running.delete(account.id);
  }
}
