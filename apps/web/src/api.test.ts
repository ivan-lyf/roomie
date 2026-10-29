import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchMe } from './api';

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(body, { status })),
  );

describe('a refused AI step', () => {
  it('says why, with the reason code and when the allowance is back', async () => {
    answer(429, {
      error: "You've used today's AI allowance ($1.00).",
      code: 'allowance_reached',
      resetsAt: '2026-10-30T07:00:00.000Z',
    });
    const error = await fetchMe().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "You've used today's AI allowance ($1.00).",
      status: 429,
      code: 'allowance_reached',
      resetsAt: new Date('2026-10-30T07:00:00.000Z'),
    });
  });

  it('keeps any other error as it was', async () => {
    answer(503, { error: 'DATABASE_URL is not set' });
    const error = await fetchMe().catch((e: unknown) => e);
    expect(error).toMatchObject({ message: 'DATABASE_URL is not set', status: 503 });
    expect((error as ApiError).code).toBeUndefined();
  });
});
