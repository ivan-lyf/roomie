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
