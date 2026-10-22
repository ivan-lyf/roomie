import { useCursor } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { roomMaterials } from '@roomie/geometry';
import type { FloorMaterial, Floorplan, Room } from '@roomie/schema';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Shape, ShapeGeometry, Vector2 } from 'three';
import { FLOORS, useFloorTextures } from './floorTextures';

/** A pointer that moved further than this between down and up was orbiting, not clicking. */
const CLICK_SLOP = 4;

type Props = { plan: Floorplan; onRoom?: (roomId: string) => void };

/** A floor for each room; clicking one picks the room. */
export function Floors({ plan, onRoom }: Props) {
  return plan.rooms.map((room) => (
    <Floor key={room.id} room={room} floor={roomMaterials(plan, room).floor} onRoom={onRoom} />
  ));
}

type FloorProps = { room: Room; floor: FloorMaterial } & Pick<Props, 'onRoom'>;

function Floor({ room, floor, onRoom }: FloorProps) {
  const geometry = useMemo(() => roomShape(room), [room]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && onRoom !== undefined);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onRoom || e.delta > CLICK_SLOP) return;
    e.stopPropagation();
    onRoom(room.id);
  };
  return (
    <mesh
      geometry={geometry}
      rotation-x={-Math.PI / 2}
      receiveShadow
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <Suspense fallback={<meshStandardMaterial color={FLOORS[floor].color} roughness={0.8} />}>
        <TexturedFloor floor={floor} />
      </Suspense>
    </mesh>
  );
}

function TexturedFloor({ floor }: { floor: FloorMaterial }) {
  const { map, roughnessMap } = useFloorTextures(floor);
  return <meshStandardMaterial map={map} roughnessMap={roughnessMap} />;
}

/**
 * A room's outline as a flat shape facing up once turned onto the floor (by -90° about X). Its
 * UVs are plan meters, so textures can be laid out at their real size.
 */
export function roomShape(room: Room): ShapeGeometry {
  return new ShapeGeometry(new Shape(room.boundary.map((p) => new Vector2(p.x, -p.y))));
}
