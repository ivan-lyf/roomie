import { Html, useCursor } from '@react-three/drei';
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { type LayoutProblem, roomAt, snapPlacement } from '@roomie/geometry';
import {
  FURNISHABLE,
  type Floorplan,
  type Placement,
  type Product,
  type Vec2,
} from '@roomie/schema';
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { Plane, type Ray, Vector3 } from 'three';
import { PREVIEW_ID, type Problems } from '../../furnishing';
import { useFloorplan } from '../../stores/floorplan';
import { useFurnish } from '../../stores/furnish';
import { useProducts } from '../../stores/products';
import { ProductModel } from '../ProductModel';

/** A pointer that moves further than this, in pixels, is dragging the item, not clicking it. */
const DRAG_SLOP = 4;
const FLOOR = new Plane(new Vector3(0, 1, 0), 0);

/** Where a ray from the camera meets the floor, on the plan. */
function floorPoint(ray: Ray): Vec2 | undefined {
  const hit = ray.intersectPlane(FLOOR, new Vector3());
  return hit ? { x: hit.x, y: hit.z } : undefined;
}

type Props = { plan: Floorplan; problems: Problems };

/**
 * The home's furniture, each item where it stands, or where it's being dragged; items whose
 * product hasn't loaded wait. A product picked to place shows where it would go.
 */
export function Furniture({ plan, problems }: Props) {
  const products = useProducts((s) => s.byArticle);
  const armed = useFurnish((s) => s.armed);
  const preview = useFurnish((s) => s.preview);
  const placing = armed && preview && !preview.id && products.get(armed.articleNo);
  return (
    <>
      {plan.furniture.map((placement) => {
        const product = products.get(placement.articleNo);
        if (!product) return null;
        const at = preview?.id === placement.id ? { ...placement, ...preview } : placement;
        return (
          <Movable
            key={placement.id}
            plan={plan}
            placement={at}
            product={product}
            problems={problems.byItem.get(placement.id)}
          />
        );
      })}
      {placing && (
        <Item
          placement={{ ...preview, id: PREVIEW_ID, articleNo: armed.articleNo }}
          product={placing}
        >
          <Why problems={problems.byItem.get(PREVIEW_ID)} height={placing.dims.h} />
        </Item>
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
  const last = useRef<{ roomId: string; at: Vec2 }>(undefined);
  const spot = (roomId: string, at: Vec2) => {
    const room = plan.rooms.find((r) => r.id === roomId);
    if (!armed || !product || !room || !room.furnishable || !FURNISHABLE.has(room.roomType)) {
      return undefined;
    }
    return { ...snapPlacement({ ...at, rotation: armed.rotation, roomId }, product, plan), roomId };
  };
  // A turn with R shows at once, without waiting for the pointer to move.
  const rotation = armed?.rotation;
  useEffect(() => {
    if (rotation === undefined || !last.current) return;
    useFurnish.getState().setPreview(spot(last.current.roomId, last.current.at));
    // Only the turn needs to bring the preview up to date; moves do it themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation]);
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
      last.current = roomId && at ? { roomId, at } : undefined;
      if (!armed) return;
      useFurnish.getState().setPreview(roomId && at ? spot(roomId, at) : undefined);
    },
  };
}

type MovableProps = {
  plan: Floorplan;
  placement: Placement;
  product: Product;
  problems: LayoutProblem[] | undefined;
};

/**
 * An item that a click selects and a drag moves across the floor, snapping to the walls (Alt
 * holds the snap off). The move is saved, as one edit, when the item is let go.
 */
function Movable({ plan, placement, product, problems }: MovableProps) {
  const get = useThree((s) => s.get);
  /** Holds the camera still while an item is dragged. */
  const orbit = (enabled: boolean) => {
    const controls = get().controls as { enabled: boolean } | null;
    if (controls) controls.enabled = enabled;
  };
  const selected = useFurnish((s) => s.selected === placement.id);
  // While a product is being placed, clicks go through items to the floor behind them.
  const placing = useFurnish((s) => s.armed !== undefined);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && !placing, 'grab');
  const grab = useRef<{ offset: Vec2; from: Vec2; moved: boolean }>(undefined);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    useFurnish.getState().select(placement.id);
    const at = floorPoint(e.ray);
    if (!at) return;
    const offset = { x: placement.x - at.x, y: placement.y - at.y };
    grab.current = { offset, from: { x: e.clientX, y: e.clientY }, moved: false };
    (e.target as unknown as Element).setPointerCapture(e.pointerId);
    orbit(false);
  };
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const g = grab.current;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.from.x, e.clientY - g.from.y) < DRAG_SLOP) return;
    const at = floorPoint(e.ray);
    if (!at) return;
    g.moved = true;
    const to = { x: at.x + g.offset.x, y: at.y + g.offset.y };
    const roomId = roomAt(plan.rooms, to)?.id ?? placement.roomId;
    const stored = plan.furniture.find((f) => f.id === placement.id) ?? placement;
    const spot = e.altKey
      ? { ...to, rotation: stored.rotation }
      : snapPlacement({ ...to, rotation: stored.rotation, roomId }, product, plan);
    useFurnish.getState().setPreview({ id: placement.id, ...spot, roomId });
  };
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const g = grab.current;
    if (!g) return;
    grab.current = undefined;
    (e.target as unknown as Element).releasePointerCapture(e.pointerId);
    orbit(true);
    const { preview, setPreview } = useFurnish.getState();
    if (g.moved && preview?.id === placement.id) {
      const { x, y, rotation, roomId } = preview;
      useFloorplan.getState().moveItem(placement.id, { x, y, rotation, roomId });
    }
    setPreview(undefined);
  };

  return (
    <Item placement={placement} product={product}>
      {placing ? null : (
        <group
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={(e) => e.stopPropagation()}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
        >
          <HitBox product={product} />
        </group>
      )}
      {selected && <Why problems={problems} height={product.dims.h} />}
    </Item>
  );
}

function Item(props: { placement: Placement; product: Product; children?: ReactNode }) {
  const { placement, product } = props;
  return (
    <group position={[placement.x, 0, placement.y]} rotation-y={placement.rotation}>
      {product.modelUrl ? (
        <Suspense fallback={<StandIn product={product} />}>
          <ProductModel url={product.modelUrl} />
        </Suspense>
      ) : (
        <StandIn product={product} />
      )}
      {props.children}
    </group>
  );
}

/** An invisible box around the item, so a click anywhere in its outline picks it. */
function HitBox({ product }: { product: Product }) {
  const { w, d, h } = product.dims;
  return (
    <mesh position-y={h / 2}>
      <boxGeometry args={[w, h, d]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/** Above an item with a problem, what's wrong, in words. */
function Why({ problems, height }: { problems: LayoutProblem[] | undefined; height: number }) {
  if (!problems?.length) return null;
  return (
    <Html position={[0, height + 0.25, 0]} center zIndexRange={[20, 0]}>
      <div className="pointer-events-none w-56 rounded-md bg-red-700 px-2 py-1 text-center text-xs text-white shadow">
        {problems[0]!.message}
        {problems.length > 1 && ` (+${problems.length - 1} more)`}
      </div>
    </Html>
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
