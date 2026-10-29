import { Line } from '@react-three/drei';
import { doorZones, itemOutline, zoneOf } from '@roomie/geometry';
import type { Floorplan, Vec2 } from '@roomie/schema';
import { useMemo } from 'react';
import { Shape, Vector2 } from 'three';
import { liveFurniture, PREVIEW_ID, type Problems } from '../../furnishing';
import { useFurnish } from '../../stores/furnish';
import { useProducts } from '../../stores/products';

const RED = '#dc2626';
const OUTLINE = '#44403c';
const ZONE = '#0284c7';

type Props = { plan: Floorplan; problems: Problems };

/**
 * Marks on the floor: the footprint of the item selected or being placed, with the space it
 * needs to be used, and in red every item with a problem and every doorway it blocks.
 */
export function Marks({ plan, problems }: Props) {
  const products = useProducts((s) => s.byArticle);
  const armed = useFurnish((s) => s.armed);
  const preview = useFurnish((s) => s.preview);
  const selected = useFurnish((s) => s.selected);
  const live = liveFurniture(plan.furniture, armed, preview);
  const doors = useMemo(() => doorZones(plan), [plan]);
  const blocked = new Set(
    problems.all.filter((p) => p.code === 'blocks_door').map((p) => p.ids[1]),
  );

  return (
    <group position-y={0.006}>
      {live.map((item) => {
        const product = products.get(item.articleNo);
        if (!product) return null;
        const wrong = problems.byItem.get(item.id) ?? [];
        const focused = item.id === selected || item.id === PREVIEW_ID || item.id === preview?.id;
        if (wrong.length === 0 && !focused) return null;
        const outline = itemOutline(item, product);
        const zone = focused ? zoneOf(item, product) : undefined;
        const cramped = wrong.some((p) => p.code === 'no_clearance' && p.ids[0] === item.id);
        return (
          <group key={item.id}>
            {wrong.length > 0 && <Flat points={outline} color={RED} opacity={0.35} />}
            <Outline points={outline} color={wrong.length > 0 ? RED : OUTLINE} />
            {zone?.parts.map((part, i) => (
              <Flat key={i} points={part} color={cramped ? RED : ZONE} opacity={0.18} />
            ))}
          </group>
        );
      })}
      {doors
        .filter((d) => blocked.has(d.openingId))
        .flatMap((d) =>
          d.parts.map((part, i) => (
            <Flat key={`${d.openingId}-${i}`} points={part} color={RED} opacity={0.22} />
          )),
        )}
    </group>
  );
}

/** A filled shape lying on the floor. */
function Flat({ points, color, opacity }: { points: Vec2[]; color: string; opacity: number }) {
  const shape = useMemo(() => new Shape(points.map((p) => new Vector2(p.x, -p.y))), [points]);
  return (
    <mesh rotation-x={-Math.PI / 2}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/** An outline on the floor, seen through the furniture standing on it. */
function Outline({ points, color }: { points: Vec2[]; color: string }) {
  const line = [...points, points[0]!].map((p) => [p.x, 0.004, p.y] as [number, number, number]);
  return <Line points={line} color={color} lineWidth={2} depthTest={false} renderOrder={10} />;
}
