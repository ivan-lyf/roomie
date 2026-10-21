import { Document } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { describe, expect, it } from 'vitest';
import { normalizeModel, topBandCenterZ } from './normalize';

type Box = { min: [number, number, number]; max: [number, number, number] };

/** A document with one node per box, under an optional offset parent. */
function makeDoc(boxes: Box[], parentTranslation: [number, number, number] = [0, 0, 0]) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const parent = doc.createNode('parent').setTranslation(parentTranslation);
  for (const { min, max } of boxes) {
    const corners: number[] = [];
    for (const x of [min[0], max[0]])
      for (const y of [min[1], max[1]])
        for (const z of [min[2], max[2]]) corners.push(x, y, z);
    const position = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(corners))
      .setBuffer(buffer);
    const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position));
    parent.addChild(doc.createNode().setMesh(mesh));
  }
  const scene = doc.createScene().addChild(parent);
  doc.getRoot().setDefaultScene(scene);
  return doc;
}

const bounds = (doc: Document) => getBounds(doc.getRoot().listScenes()[0]!);
const expectClose = (actual: ArrayLike<number>, expected: number[]) =>
  expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 6));

describe('normalizeModel', () => {
  it('scales to the listed dims with the origin at the bottom center', () => {
    const doc = makeDoc([{ min: [0, 0, 0], max: [2, 1, 0.5] }], [5, 3, -2]);
    const result = normalizeModel(doc, { w: 1.8, d: 0.9, h: 0.8 });
    const { min, max } = bounds(doc);
    expectClose(min, [-0.9, 0, -0.45]);
    expectClose(max, [0.9, 0.8, 0.45]);
    expectClose(result.sourceSize, [2, 1, 0.5]);
    expectClose(result.scale, [0.9, 0.8, 1.8]);
  });

  it('applies yaw before fitting, so width ends up along X', () => {
    // Long side along Z: a model whose front faces -X.
    const doc = makeDoc([{ min: [-0.25, 0, -1], max: [0.25, 0.8, 1] }]);
    const result = normalizeModel(doc, { w: 2, d: 0.5, h: 0.8 }, Math.PI / 2);
    expectClose(result.sourceSize, [2, 0.8, 0.5]);
    expectClose(result.scale, [1, 1, 1]);
    const { min, max } = bounds(doc);
    expectClose(min, [-1, 0, -0.25]);
    expectClose(max, [1, 0.8, 0.25]);
  });

  it('rejects an empty model', () => {
    const doc = makeDoc([{ min: [0, 0, 0], max: [1, 0, 1] }]);
    expect(() => normalizeModel(doc, { w: 1, d: 1, h: 1 })).toThrow(/empty bounding box/);
  });
});

describe('topBandCenterZ', () => {
  // A sofa-like shape: a low seat across the full depth, a tall back at -Z.
  const sofa = (): Box[] => [
    { min: [-1, 0, -0.5], max: [1, 0.45, 0.5] },
    { min: [-1, 0, -0.5], max: [1, 0.9, -0.3] },
  ];

  it('is negative when the tall part is at the back (front faces +Z)', () => {
    expect(topBandCenterZ(makeDoc(sofa()))).toBeLessThan(0);
  });

  it('is positive when the model faces -Z', () => {
    const doc = makeDoc(sofa());
    normalizeModel(doc, { w: 2, d: 1, h: 0.9 }, Math.PI);
    expect(topBandCenterZ(doc)).toBeGreaterThan(0);
  });
});

