import { obstacleHeight } from '@roomie/geometry';
import type { Floorplan, Obstacle, ObstacleKind } from '@roomie/schema';
import { useEffect, useMemo } from 'react';
import { ExtrudeGeometry, Shape, Vector2 } from 'three';

const COLORS: Record<ObstacleKind, string> = {
  counter: '#ebe8e2',
  appliance: '#b9b6b0',
  closet: '#f1eee8',
  column: '#f1eee8',
  radiator: '#f7f5f0',
  fireplace: '#5b5650',
  other: '#d6d3d1',
};

/** Fixed things drawn on the plan (counters, closets, columns), as extruded outlines. */
export function Obstacles({ plan }: { plan: Floorplan }) {
  return plan.obstacles.map((obstacle) => (
    <Extruded key={obstacle.id} obstacle={obstacle} height={obstacleHeight(plan, obstacle)} />
  ));
}

function Extruded({ obstacle, height }: { obstacle: Obstacle; height: number }) {
  // Extruded along +Z, then turned by -90° about X: depth becomes height, (x, -y) lands on
  // (x, 0, y).
  const geometry = useMemo(() => {
    const shape = new Shape(obstacle.polygon.map((p) => new Vector2(p.x, -p.y)));
    return new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  }, [obstacle, height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} rotation-x={-Math.PI / 2} castShadow receiveShadow>
      <meshStandardMaterial color={COLORS[obstacle.kind]} roughness={0.7} />
    </mesh>
  );
}
