import { z } from 'zod';

// Accounts (PLAN.md M6): sign-in exists only to limit what each account spends on LLM calls.

/** Why a step that calls an LLM was refused, for the app to say in words. */
export const RefusalCode = z.enum([
  'sign_in_required',
  'allowance_reached',
  'busy',
  'auth_unavailable',
]);
export type RefusalCode = z.infer<typeof RefusalCode>;

/** What a refused request answers. */
export const Refusal = z.object({
  error: z.string(),
  code: RefusalCode,
  /** When an allowance used up for the day starts again. */
  resetsAt: z.coerce.date().optional(),
});
export type Refusal = z.infer<typeof Refusal>;

/** The routes that call an LLM. */
export const LlmRoute = z.enum(['read_plan', 'furnish_home', 'new_pieces']);
export type LlmRoute = z.infer<typeof LlmRoute>;

/** A request that called an LLM, and what it cost. Never deleted. */
export const Usage = z.object({
  id: z.uuid(),
  /** The Supabase user who asked. */
  accountId: z.uuid(),
  route: LlmRoute,
  floorplanId: z.uuid().nullable(),
  /** The model that answered; none when nothing was asked. */
  model: z.string().nullable(),
  /** Every call the request made, repairs and second tries included. */
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** In US dollars; null when the model's price isn't known (Gemini's free tier). */
  costUsd: z.number().nonnegative().nullable(),
  /** Answered from the cache: nothing asked, nothing paid. */
  cached: z.boolean(),
  status: z.enum(['done', 'failed']),
  createdAt: z.coerce.date(),
});
export type Usage = z.infer<typeof Usage>;

/** The signed-in account and what it has spent on LLM calls today (GET /me). */
export const Me = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  spentUsd: z.number().nonnegative(),
  allowanceUsd: z.number().nonnegative(),
  /** When today's spending starts again from nothing: midnight where the allowance is counted. */
  resetsAt: z.coerce.date(),
});
export type Me = z.infer<typeof Me>;
