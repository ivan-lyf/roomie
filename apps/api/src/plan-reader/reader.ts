import { readFileSync } from 'node:fs';
import type { ImageSize } from '@roomie/geometry';
import type { RawPlan } from '@roomie/schema';

/** The prompt that asks for a plan, versioned: every reading records which one it used. */
export const PLAN_READ_PROMPT = {
  version: 'plan-read.v2',
  text: readFileSync(new URL('../prompts/plan-read.v2.md', import.meta.url), 'utf8'),
};

/** The same for Claude: the coordinates are in pixels, the way Claude's vision models give them. */
export const PLAN_READ_CLAUDE_PROMPT = {
  version: 'plan-read-claude.v1',
  text: readFileSync(new URL('../prompts/plan-read-claude.v1.md', import.meta.url), 'utf8'),
};

export type PlanImage = ImageSize & { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' };

export type ReaderUsage = { inputTokens: number; outputTokens: number };

export type ReaderResult = {
  /** The model that answered, when the reader can try more than one. */
  model?: string;
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
  /** The model it reads with first. */
  model: string;
  promptVersion: string;
  /** Throws a `ReaderError` when it can't read the plan. */
  read(image: PlanImage, signal?: AbortSignal): Promise<ReaderResult>;
  /** The plan from an answer read before, for answers kept in a cache. */
  planFromRaw(raw: unknown, size: ImageSize): RawPlan;
}

/**
 * Why a plan couldn't be read, with the HTTP status the API answers with. `unavailable` is a
 * model too busy or out of its quota, which another model might not be.
 */
export class ReaderError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 502 | 504,
    readonly unavailable = false,
  ) {
    super(message);
    this.name = 'ReaderError';
  }
}
