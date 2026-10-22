import type { Document } from '@gltf-transform/core';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/**
 * Longest texture side. A furnished home shows 15–20 models at once, so this bounds GPU
 * memory (about 22 MB per model at 1024 px); lower it and re-run if whole homes struggle.
 */
export const MAX_TEXTURE_SIZE = 1024;
/** Models with more triangles than this are simplified towards it. */
export const TRIANGLE_BUDGET = 30_000;
/** Simplification stops before the budget rather than move a surface by more than this share of the model's radius. */
const MAX_SIMPLIFY_ERROR = 0.001;

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);

export function triangleCount(doc: Document): number {
  let count = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      count += (indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0)) / 3;
    }
  }
  return count;
}

/**
 * Shrinks a fitted model for the browser: duplicates merged, heavy meshes simplified,
 * textures resized and re-encoded as WebP, and geometry meshopt-compressed (three.js decodes
 * it without fetching a decoder). Writing needs `MeshoptEncoder` as 'meshopt.encoder'.
 */
export async function optimizeModel(doc: Document): Promise<void> {
  const triangles = triangleCount(doc);
  const ratio = TRIANGLE_BUDGET / triangles;
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    ...(ratio < 1
      ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: MAX_SIMPLIFY_ERROR })]
      : []),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE],
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
}
