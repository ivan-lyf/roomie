import { useGLTF } from '@react-three/drei';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Box3, type Material, type Mesh, type Object3D, Texture, Vector3 } from 'three';
import type { Size } from './size';

type Props = {
  url: string;
  /** Gets the model's size once it's loaded, to check it against the listed size. */
  onMeasured?: (size: Size) => void;
};

/**
 * A processed product model. tools/models already scaled it to its listed
 * dims, with the origin at the bottom center and the front facing +Z, so it
 * renders as is: never adjust scale or orientation here.
 */
export function ProductModel({ url, onMeasured }: Props) {
  // Models are meshopt-compressed, which three.js decodes without fetching a Draco decoder.
  const { scene } = useGLTF(url, false);
  const model = useMemo(() => withShadows(scene.clone(true)), [scene]);

  useLayoutEffect(() => {
    if (!onMeasured) return;
    const size = new Box3().setFromObject(model, true).getSize(new Vector3());
    onMeasured([size.x, size.y, size.z]);
  }, [model, onMeasured]);

  useEffect(() => {
    clearTimeout(pendingRelease.get(url));
    pendingRelease.delete(url);
    users.set(url, (users.get(url) ?? 0) + 1);
    return () => {
      const left = users.get(url)! - 1;
      users.set(url, left);
      // Copies share the loaded model's geometry: free it once the last one is gone.
      if (left === 0) scheduleRelease(url, scene);
    };
  }, [url, scene]);

  return <primitive object={model} />;
}

/** How many copies of each model are on screen: four chairs are one model shown four times. */
const users = new Map<string, number>();
const pendingRelease = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Free a model's GPU resources and loader cache entry once nothing shows it.
 * Deferred so React StrictMode's unmount-and-remount in development, which
 * cancels it, doesn't dispose a model that's still on screen.
 */
function scheduleRelease(url: string, scene: Object3D) {
  pendingRelease.set(
    url,
    setTimeout(() => {
      pendingRelease.delete(url);
      dispose(scene);
      useGLTF.clear(url);
    }, 0),
  );
}

function withShadows(root: Object3D): Object3D {
  root.traverse((o) => {
    if ((o as Mesh).isMesh) o.castShadow = true;
  });
  return root;
}

function dispose(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of ([] as Material[]).concat(mesh.material)) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
