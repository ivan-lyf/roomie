import { describe, expect, it } from 'vitest';
import { Allowance, dayOf, typicalCost } from './allowance';
import { usage } from './db/schema';
import { testDb } from './test/db';

const vancouver = 'America/Vancouver';
const iso = (d: Date) => d.toISOString();

describe('dayOf', () => {
  it("runs from the time zone's midnight to the next", () => {
    const day = dayOf(new Date('2026-10-29T20:00:00Z'), vancouver);
    expect([iso(day.start), iso(day.end)]).toEqual([
      '2026-10-29T07:00:00.000Z',
      '2026-10-30T07:00:00.000Z',
    ]);
    // A minute before midnight in Vancouver is still the 28th there.
    expect(iso(dayOf(new Date('2026-10-29T06:59:00Z'), vancouver).start)).toBe(
      '2026-10-28T07:00:00.000Z',
    );
  });

  it('is 23 hours long when daylight time starts, and 25 when it ends', () => {
    // In the time zone data, Vancouver stays on daylight time after March 2026; New York changes.
    const spring = dayOf(new Date('2026-03-08T20:00:00Z'), 'America/New_York');
    expect([iso(spring.start), iso(spring.end)]).toEqual([
      '2026-03-08T05:00:00.000Z',
      '2026-03-09T04:00:00.000Z',
    ]);
    const fall = dayOf(new Date('2026-11-01T20:00:00Z'), 'America/New_York');
    expect([iso(fall.start), iso(fall.end)]).toEqual([
      '2026-11-01T04:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
    ]);
    expect(iso(dayOf(new Date('2026-10-29T12:00:00Z'), 'UTC').start)).toBe(
      '2026-10-29T00:00:00.000Z',
    );
  });
});

describe('Allowance', () => {
  const me = { id: '11111111-2222-4333-8444-555555555555', email: 'ivan@example.com' };
  const other = { ...me, id: '99999999-2222-4333-8444-555555555555' };
  const fresh = { ...me, id: 'aaaaaaaa-2222-4333-8444-555555555555' };
  const now = new Date('2026-10-29T20:00:00Z');
  const spend = (accountId: string, costUsd: number | null, at: string) => ({
    accountId,
    route: 'furnish_home' as const,
    floorplanId: null,
    model: 'claude-opus-5-5',
    inputTokens: 1,
    outputTokens: 1,
    costUsd,
    cached: false,
    status: 'done' as const,
    createdAt: new Date(at),
  });

  async function allowance(dailyUsd = 1) {
    const db = await testDb();
    await db.insert(usage).values([
      spend(me.id, 0.4, '2026-10-29T08:00:00Z'),
      spend(me.id, 0.3, '2026-10-29T19:00:00Z'),
      spend(me.id, null, '2026-10-29T19:30:00Z'),
      // Yesterday in Vancouver, and someone else.
      spend(me.id, 5, '2026-10-29T06:00:00Z'),
      spend(other.id, 5, '2026-10-29T19:00:00Z'),
    ]);
    return new Allowance(db, { dailyUsd, timeZone: vancouver }, () => now);
  }

  it("counts today's spend, in its time zone, and says when it starts again", async () => {
    const today = await (await allowance()).today(me);
    expect(today).toEqual({
      ...me,
      spentUsd: 0.7,
      allowanceUsd: 1,
      resetsAt: new Date('2026-10-30T07:00:00Z'),
    });
  });

  it('lets a request through while one more like it fits, one at a time', async () => {
    const a = await allowance();
    // $0.70 spent: new pieces on Opus (about $0.07) fit.
    expect(typicalCost('new_pieces', 'claude-opus-5-5')).toBeLessThan(0.3);
    expect(typicalCost('furnish_home', 'claude-opus-5-5')).toBeGreaterThan(0.1);
    expect(await a.take(me, 'new_pieces', 'claude-opus-5-5')).toBeUndefined();
    expect(await a.take(me, 'new_pieces', 'claude-opus-5-5')).toMatchObject({
      status: 409,
      refusal: { code: 'busy' },
    });
    a.release(me);
    expect(await a.take(me, 'new_pieces', 'claude-opus-5-5')).toBeUndefined();
    a.release(me);
    // Someone else's spending is theirs.
    expect(await a.take(fresh, 'read_plan', 'claude-opus-5-5')).toBeUndefined();
    expect(await a.take(other, 'read_plan', 'claude-opus-5-5')).toMatchObject({ status: 429 });
  });

  it('refuses once the day is spent, until midnight, and everything with no allowance', async () => {
    const tight = await allowance(0.75);
    expect(await tight.take(me, 'furnish_home', 'claude-opus-5-5')).toEqual({
      status: 429,
      refusal: {
        error:
          "You've used today's AI allowance ($0.75). It's back at midnight; " +
          'you can still edit by hand.',
        code: 'allowance_reached',
        resetsAt: new Date('2026-10-30T07:00:00Z'),
      },
    });
    // A free model fits what's left, and the refusal didn't hold the account.
    expect(await tight.take(me, 'read_plan', 'gemini-3.8-flash')).toBeUndefined();
    const none = await allowance(0);
    expect(await none.take(fresh, 'read_plan', 'gemini-3.8-flash')).toMatchObject({
      status: 429,
    });
  });
});
