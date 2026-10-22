import { Edges, Grid, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import type { Dims, Product } from '@roomie/schema';
import { Suspense, useEffect } from 'react';
import { Vector3 } from 'three';
import { ProductModel } from './ProductModel';
import type { Size } from './size';

/** 'front' looks straight at the product's front (+Z); 'angle' from the front right, above. */
export type View = 'angle' | 'front';

type Props = {
  product: Product | undefined;
  view: View;
  onMeasured: (size: Size) => void;
};

export function ProductScene({ product, view, onMeasured }: Props) {
  return (
    <Canvas shadows="percentage" camera={{ position: [2.4, 1.5, 3.2], fov: 45 }}>
      <color attach="background" args={['#f5f5f4']} />
      <hemisphereLight args={['#ffffff', '#d6d3d1', 1.5]} />
      <directionalLight
        position={[3, 5, 4]}
        intensity={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.2} />
      </mesh>
      <Grid
        position-y={0.001}
        infiniteGrid
        cellSize={0.1}
        sectionSize={1}
        cellColor="#d6d3d1"
        sectionColor="#a8a29e"
        fadeDistance={20}
      />
      {product && (
        <>
          <Framing dims={product.dims} view={view} />
          <ListedSize dims={product.dims} />
          {product.modelUrl ? (
            <Suspense fallback={null}>
              <ProductModel key={product.modelUrl} url={product.modelUrl} onMeasured={onMeasured} />
            </Suspense>
          ) : (
            <PlaceholderBox dims={product.dims} />
          )}
        </>
      )}
      <OrbitControls target={[0, 0.4, 0]} makeDefault />
    </Canvas>
  );
}

/** Moves the camera so the whole product is in view, whatever its size. */
function Framing({ dims, view }: { dims: Dims; view: View }) {
  const camera = useThree((s) => s.camera);
  // OrbitControls registers itself with makeDefault.
  const controls = useThree((s) => s.controls) as { target: Vector3; update(): void } | null;
  const { w, h, d } = dims;
  useEffect(() => {
    const target = new Vector3(0, h / 2, 0);
    const direction = view === 'front' ? new Vector3(0, 0.3, 1) : new Vector3(0.6, 0.45, 1);
    const distance = 1.9 * Math.max(w, h, d) + 0.6;
    camera.position.copy(target).addScaledVector(direction.normalize(), distance);
    controls?.target.copy(target);
    controls?.update();
  }, [w, h, d, view, camera, controls]);
  return null;
}

/** The listed bounding box, outlined. A correct model fills it exactly. */
function ListedSize({ dims }: { dims: Dims }) {
  return (
    <mesh position={[0, dims.h / 2, 0]}>
      <boxGeometry args={[dims.w, dims.h, dims.d]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      <Edges color="#e11d48" />
    </mesh>
  );
}

/** For products with no model file yet; `pnpm models:process` gives every product one. */
function PlaceholderBox({ dims }: { dims: Dims }) {
  return (
    <mesh position={[0, dims.h / 2, 0]} castShadow>
      <boxGeometry args={[dims.w, dims.h, dims.d]} />
      <meshStandardMaterial color="#d6d3d1" />
    </mesh>
  );
}
