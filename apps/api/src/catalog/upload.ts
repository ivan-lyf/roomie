import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Storage } from '../storage';
import { modelPath } from './store';

/** Parallel uploads: enough to use the connection without tripping rate limits. */
const CONCURRENCY = 8;

export type UploadResult = { uploaded: number; unchanged: number };

/**
 * Uploads the processed models (data/models/<itemNo>.glb) that are new or changed, judged by
 * their MD5 against the bucket's. Run before publishing, so no product points at a missing file.
 */
export async function uploadModels(
  storage: Pick<Storage, 'list' | 'put'>,
  dataDir: string,
  itemNos: readonly string[],
  onProgress: (done: number) => void = () => {},
): Promise<UploadResult> {
  const remote = await storage.list();
  const queue = [...itemNos];
  const result: UploadResult = { uploaded: 0, unchanged: 0 };
  const worker = async () => {
    for (let itemNo = queue.shift(); itemNo !== undefined; itemNo = queue.shift()) {
      const body = await readFile(modelPath(dataDir, itemNo));
      const key = `${itemNo}.glb`;
      if (remote.get(key) === createHash('md5').update(body).digest('hex')) {
        result.unchanged++;
      } else {
        await storage.put(key, body, 'model/gltf-binary');
        result.uploaded++;
      }
      onProgress(result.uploaded + result.unchanged);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return result;
}
