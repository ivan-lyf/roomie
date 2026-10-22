import { roomCeiling } from '@roomie/geometry';
import type { Floorplan, Room } from '@roomie/schema';
import { useEffect, useMemo } from 'react';
import { Shape, ShapeGeometry, Vector2 } from 'three';

/**
 * A ceiling over each room, facing down: seen from inside a room, and invisible from above, so
 * they never hide the home from the usual view. They don't block the light.
 */
export function Ceilings({ plan }: { plan: Floorplan }) {
  return plan.rooms.map((room) => (
    <Ceiling key={room.id} room={room} height={roomCeiling(plan, room)} />
  ));
}

function Ceiling({ room, height }: { room: Room; height: number }) {
  // Turned by +90° about X, (x, y) lands on (x, 0, y) and the shape faces down.
  const geometry = useMemo(
    () => new ShapeGeometry(new Shape(room.boundary.map((p) => new Vector2(p.x, p.y)))),
    [room],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} rotation-x={Math.PI / 2} position-y={height}>
      <meshStandardMaterial color="#f7f6f3" roughness={0.95} />
    </mesh>
  );
}
