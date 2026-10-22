import { Document } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_TEXTURE_SIZE, optimizeModel, TRIANGLE_BUDGET, triangleCount } from './optimize';

/** A flat grid of `n` x `n` quads, so 2n² triangles. */
function gridDoc(n: number) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) positions.push(i / n, 0, j / n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j;
      indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1);
    }
  }
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer),
    )
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer));
  const node = doc.createNode().setMesh(doc.createMesh().addPrimitive(prim));
  doc.getRoot().setDefaultScene(doc.createScene().addChild(node));
  return { doc, prim };
}

describe('optimizeModel', () => {
  it('simplifies meshes over the triangle budget', async () => {
    const { doc } = gridDoc(200);
    expect(triangleCount(doc)).toBe(80_000);
    await optimizeModel(doc);
    expect(triangleCount(doc)).toBeLessThanOrEqual(TRIANGLE_BUDGET * 1.1);
  });

  it('leaves light meshes alone', async () => {
    const { doc } = gridDoc(20);
    await optimizeModel(doc);
    expect(triangleCount(doc)).toBe(800);
  });

  it('resizes large textures to WebP and compresses the geometry', async () => {
    const { doc, prim } = gridDoc(4);
    // A gradient: prune() would replace a single-color texture with a plain material color.
    const [width, height] = [2048, 1024];
    const pixels = new Uint8Array(width * height * 3).map((_, i) => (i / 3) % width);
    const png = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
    const texture = doc.createTexture().setImage(new Uint8Array(png)).setMimeType('image/png');
    prim.setMaterial(doc.createMaterial().setBaseColorTexture(texture));

    await optimizeModel(doc);

    const [out] = doc.getRoot().listTextures();
    expect(out?.getMimeType()).toBe('image/webp');
    const { width: w, height: h } = await sharp(out!.getImage()!).metadata();
    expect([w, h]).toEqual([MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE / 2]);
    const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
    expect(used).toContain(EXTMeshoptCompression.EXTENSION_NAME);
  });
});
