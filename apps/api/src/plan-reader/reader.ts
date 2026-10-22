import { readFileSync } from 'node:fs';
import type { ImageSize } from '@roomie/geometry';
import type { RawPlan } from '@roomie/schema';

/** The prompt that asks for a plan, versioned: every reading records which one it used. */
export const PLAN_READ_PROMPT = {
  version: 'plan-read.v1',
  text: readFileSync(new URL('../prompts/plan-read.v1.md', import.meta.url), 'utf8'),
};

export type PlanImage = ImageSize & { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' };

export type ReaderUsage = { inputTokens: number; outputTokens: number };

export type ReaderResult = {
  /** The model's answer as it came, for the record and for the eval's cache. */
  raw: unknown;
  /** The same, in image pixels. */
  plan: RawPlan;
  usage?: ReaderUsage;
  durationMs: number;
};

/**
 * Reads a floor plan image with a vision model: walls, openings, rooms, fixtures and text, in
 * image pixels. Code tidies and checks all of it afterwards; nothing it returns is used as is.
 */
export interface PlanReader {
  provider: string;
  model: string;
  promptVersion: string;
  /** Throws a `ReaderError` when it can't read the plan. */
  read(image: PlanImage, signal?: AbortSignal): Promise<ReaderResult>;
  /** The plan from an answer read before, for answers kept in a cache. */
  planFromRaw(raw: unknown, size: ImageSize): RawPlan;
}

/** Why a plan couldn't be read, with the HTTP status the API answers with. */
export class ReaderError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 502 | 504,
  ) {
    super(message);
    this.name = 'ReaderError';
  }
}
