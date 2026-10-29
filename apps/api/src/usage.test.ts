import { Usage } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import { LOCAL_ACCOUNT } from './auth';
import { usage } from './db/schema';
import { testDb } from './test/db';
import { costOf, recordUsage } from './usage';

const used = { inputTokens: 10_000, outputTokens: 4000 };

describe('costOf', () => {
  it('prices a Claude model, and charges nothing for a cached answer', () => {
    // $4 and $20 per million tokens in and out.
    expect(costOf({ model: 'claude-opus-5-5', usage: used })).toBeCloseTo(0.04 + 0.08, 6);
    expect(costOf({ model: 'claude-opus-5-5', usage: used, cached: true })).toBe(0);
  });

  it("knows no price for Gemini's free tier", () => {
    expect(costOf({ model: 'gemini-3.8-flash', usage: used })).toBeNull();
    expect(costOf({ model: null, usage: { inputTokens: 0, outputTokens: 0 } })).toBe(0);
  });
});

describe('recordUsage', () => {
  it('logs each request, a failed or cached one too', async () => {
    const db = await testDb();
    await recordUsage(db, LOCAL_ACCOUNT, 'furnish_home', null, {
      model: 'claude-haiku-5-5',
      usage: used,
      failed: true,
    });
    await recordUsage(db, LOCAL_ACCOUNT, 'read_plan', null, {
      model: 'claude-opus-5-5',
      usage: used,
      cached: true,
    });
    const rows = Usage.array().parse(await db.select().from(usage));
    expect(rows).toMatchObject([
      { route: 'furnish_home', status: 'failed', inputTokens: 10_000, cached: false },
      { route: 'read_plan', status: 'done', model: null, inputTokens: 0, costUsd: 0, cached: true },
    ]);
    expect(rows[0]!.costUsd).toBeGreaterThan(0);
    expect(rows[0]!.accountId).toBe(LOCAL_ACCOUNT.id);
  });
});
