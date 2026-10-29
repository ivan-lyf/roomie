import { snapPlacement } from '@roomie/geometry';
import { FURNISHABLE, type Floorplan, type Placement, type Product, type Vec2 } from '@roomie/schema';
import { Suspense } from 'react';
import { useFloorplan } from '../../stores/floorplan';
import { useFurnish } from '../../stores/furnish';
import { useProducts } from '../../stores/products';
import { ProductModel } from '../ProductModel';

type Props = { plan: Floorplan };

/**
 * The home's furniture, each item where it stands; items whose product hasn't loaded wait. A
 * product picked to place shows where it would go.
 */
export function Furniture({ plan }: Props) {
  const products = useProducts((s) => s.byArticle);
  const armed = useFurnish((s) => s.armed);
  const preview = useFurnish((s) => s.preview);
  const placing = armed && preview && !preview.id && products.get(armed.articleNo);
  return (
    <>
      {plan.furniture.map((placement) => {
        const product = products.get(placement.articleNo);
        return product && <Item key={placement.id} placement={placement} product={product} />;
      })}
      {placing && (
        <Item placement={{ ...preview, id: '', articleNo: armed.articleNo }} product={placing} />
      )}
    </>
  );
}

/**
 * What clicks and moves on the floors do: with a product picked, show where it would go in a
 * furnishable room and place it there on a click; otherwise pick the room.
 */
export function useFloorEvents(plan: Floorplan, onRoom: (roomId: string) => void) {
  const armed = useFurnish((s) => s.armed);
  const product = useProducts((s) => (armed ? s.byArticle.get(armed.articleNo) : undefined));
  const spot = (roomId: string, at: Vec2) => {
    const room = plan.rooms.find((r) => r.id === roomId);
    if (!armed || !product || !room || !room.furnishable || !FURNISHABLE.has(room.roomType)) {
      return undefined;
    }
    return { ...snapPlacement({ ...at, rotation: armed.rotation, roomId }, product, plan), roomId };
  };
  return {
    onRoom: (roomId: string, at: Vec2) => {
      const placed = spot(roomId, at);
      if (!armed || !placed) {
        useFurnish.getState().select(undefined);
        onRoom(roomId);
        return;
      }
      const itemId = useFloorplan.getState().placeItem({ articleNo: armed.articleNo, ...placed });
      useFurnish.getState().select(itemId);
    },
    onHover: (roomId: string | undefined, at?: Vec2) => {
      if (!armed) return;
      useFurnish.getState().setPreview(roomId && at ? spot(roomId, at) : undefined);
    },
  };
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
