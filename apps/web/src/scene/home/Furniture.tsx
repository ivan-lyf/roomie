import type { Floorplan, Placement, Product } from '@roomie/schema';
import { Suspense } from 'react';
import { useProducts } from '../../stores/products';
import { ProductModel } from '../ProductModel';

type Props = { plan: Floorplan };

/** The home's furniture, each item where it stands; items whose product hasn't loaded wait. */
export function Furniture({ plan }: Props) {
  const products = useProducts((s) => s.byArticle);
  return plan.furniture.map((placement) => {
    const product = products.get(placement.articleNo);
    return product && <Item key={placement.id} placement={placement} product={product} />;
  });
}

function Item({ placement, product }: { placement: Placement; product: Product }) {
  return (
    <group position={[placement.x, 0, placement.y]} rotation-y={placement.rotation}>
      {product.modelUrl ? (
        <Suspense fallback={<StandIn product={product} />}>
          <ProductModel url={product.modelUrl} />
        </Suspense>
      ) : (
        <StandIn product={product} />
      )}
    </group>
  );
}

/** A plain block of the product's listed size, while its model loads or when it has none. */
function StandIn({ product }: { product: Product }) {
  const { w, d, h } = product.dims;
  return (
    <mesh position-y={h / 2} castShadow receiveShadow>
      {product.shape === 'round' ? (
        <cylinderGeometry args={[w / 2, w / 2, h, 32]} />
      ) : (
        <boxGeometry args={[w, h, d]} />
      )}
      <meshStandardMaterial color="#d6d3d1" roughness={0.9} />
    </mesh>
  );
}
