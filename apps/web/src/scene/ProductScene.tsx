import { Edges, Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Dims, Product } from '@roomie/schema';
import { Suspense } from 'react';
import { ProductModel } from './ProductModel';
import type { Size } from './size';

type Props = {
  product: Product | undefined;
  onMeasured: (size: Size) => void;
};

export function ProductScene({ product, onMeasured }: Props) {
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

/** Stand-in for products without a model, until M1 adds procedural ones. */
function PlaceholderBox({ dims }: { dims: Dims }) {
  return (
    <mesh position={[0, dims.h / 2, 0]} castShadow>
      <boxGeometry args={[dims.w, dims.h, dims.d]} />
      <meshStandardMaterial color="#d6d3d1" />
    </mesh>
  );
}
