import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlanImage, PlanReader, ReaderResult } from './reader';

/** An image's id in the cache: its bytes' hash. */
export const imageId = (image: PlanImage) =>
  createHash('sha256').update(image.bytes).digest('hex').slice(0, 16);

/** Answers already read, by image, model and prompt version: re-runs cost nothing. */
export class ReadingCache {
  constructor(private readonly dir: string) {}

  private file(image: PlanImage, reader: PlanReader) {
    return path.join(this.dir, `${imageId(image)}-${reader.model}-${reader.promptVersion}.json`);
  }

  async get(image: PlanImage, reader: PlanReader): Promise<ReaderResult | undefined> {
    const text = await readFile(this.file(image, reader), 'utf8').catch(() => undefined);
    if (!text) return undefined;
    const saved = JSON.parse(text) as Omit<ReaderResult, 'plan'>;
    return { ...saved, plan: reader.planFromRaw(saved.raw, image) };
  }

  async put(image: PlanImage, reader: PlanReader, result: ReaderResult): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const { raw, usage, durationMs } = result;
    await writeFile(this.file(image, reader), JSON.stringify({ raw, usage, durationMs }));
  }
}
