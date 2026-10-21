import type { Document, mat4, Scene, vec3 } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import type { Dims } from '@roomie/schema';

export type Vec3 = [number, number, number];

export type NormalizeResult = {
  /** Model size before scaling, after `yaw`, as [x, y, z] in meters. */
  sourceSize: Vec3;
  /** Scale applied on each axis to reach the listed dims. */
  scale: Vec3;
};

/**
 * Fit a model to the conventions in CLAUDE.md: scaled to its listed dims
 * (w = X, h = Y, d = Z), origin at the bottom center of its bounding box,
 * front facing +Z. `yaw` first rotates the source about +Y, for sources whose
 * front faces another way.
 */
export function normalizeModel(doc: Document, dims: Dims, yaw = 0): NormalizeResult {
  const scene = sceneOf(doc);
  // fit (translate + scale) -> turn (yaw) -> original roots, so the scale
  // applies along the final axes.
  const turn = doc.createNode('roomie-yaw').setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
  for (const root of scene.listChildren()) {
    scene.removeChild(root);
    turn.addChild(root);
  }
  const fit = doc.createNode('roomie-fit').addChild(turn);
  scene.addChild(fit);

  const { min, max } = getBounds(scene);
  const sourceSize: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (!sourceSize.every((s) => s > 0)) throw new Error('model has an empty bounding box');
  const scale: Vec3 = [dims.w / sourceSize[0], dims.h / sourceSize[1], dims.d / sourceSize[2]];
  fit.setScale(scale).setTranslation([
    (-(min[0] + max[0]) / 2) * scale[0],
    -min[1] * scale[1],
    (-(min[2] + max[2]) / 2) * scale[2],
  ]);
  return { sourceSize, scale };
}

/**
 * Mean Z of the vertices in the top `band` of the model's height. For a sofa,
 * chair or bed facing +Z the tall part (backrest, headboard) is at the back,
 * so this should be negative.
 */
export function topBandCenterZ(doc: Document, band = 0.2): number {
  // Two passes over the vertices instead of collecting them: models can have millions.
  let minY = Infinity;
  let maxY = -Infinity;
  forEachWorldPosition(doc, (p) => {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  });
  const cutoff = maxY - (maxY - minY) * band;
  let sumZ = 0;
  let count = 0;
  forEachWorldPosition(doc, (p) => {
    if (p[1] >= cutoff) {
      sumZ += p[2];
      count++;
    }
  });
  return sumZ / count;
}

function sceneOf(doc: Document): Scene {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('model has no scene');
  return scene;
}

function forEachWorldPosition(doc: Document, fn: (p: Vec3) => void): void {
  const el: vec3 = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      for (let i = 0; i < position.getCount(); i++) {
        fn(transform(m, position.getElement(i, el) as vec3));
      }
    }
  }
}

function transform(m: mat4, p: vec3): Vec3 {
  // Column-major 4x4, as glTF stores it.
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
