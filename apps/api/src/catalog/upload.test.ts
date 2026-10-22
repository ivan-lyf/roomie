import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uploadModels } from './upload';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'roomie-upload-'));
  await mkdir(path.join(dataDir, 'models'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

describe('uploadModels', () => {
  it('uploads new and changed models, and skips the ones already there', async () => {
    for (const [itemNo, body] of [
      ['11111111', 'same'],
      ['22222222', 'changed'],
      ['33333333', 'new'],
    ]) {
      await writeFile(path.join(dataDir, 'models', `${itemNo}.glb`), body!);
    }
    const put: [string, string, string][] = [];
    const storage = {
      list: async () =>
        new Map([
          ['11111111.glb', md5('same')],
          ['22222222.glb', md5('old')],
        ]),
      put: async (key: string, body: Uint8Array, contentType: string) => {
        put.push([key, Buffer.from(body).toString(), contentType]);
      },
    };
    const result = await uploadModels(storage, dataDir, ['11111111', '22222222', '33333333']);
    expect(result).toEqual({ uploaded: 2, unchanged: 1 });
    expect(put.sort()).toEqual([
      ['22222222.glb', 'changed', 'model/gltf-binary'],
      ['33333333.glb', 'new', 'model/gltf-binary'],
    ]);
  });
});
