import { roomMaterials } from '@roomie/geometry';
import type { FloorMaterial, Floorplan, Room } from '@roomie/schema';
import { useCursor } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { Shape, ShapeGeometry, Vector2 } from 'three';

/** A pointer that moved further than this between down and up was orbiting, not clicking. */
const CLICK_SLOP = 4;

const FLOOR_COLORS: Record<FloorMaterial, string> = {
  light_oak: '#c9a97f',
  dark_oak: '#6e4b35',
  tile: '#d9d3c7',
  concrete: '#8e8c87',
  carpet: '#8b8883',
};

type Props = { plan: Floorplan; onRoom?: (roomId: string) => void };

/** A floor for each room; clicking one picks the room. */
export function Floors({ plan, onRoom }: Props) {
  return plan.rooms.map((room) => (
    <Floor
      key={room.id}
      room={room}
      color={FLOOR_COLORS[roomMaterials(plan, room).floor]}
      onRoom={onRoom}
    />
  ));
}

function Floor({ room, color, onRoom }: { room: Room; color: string; onRoom: Props['onRoom'] }) {
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
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

/**
 * A room's outline as a flat shape facing up once turned onto the floor (by -90° about X). Its
 * UVs are plan meters, so textures can be laid out at their real size.
 */
export function roomShape(room: Room): ShapeGeometry {
  return new ShapeGeometry(new Shape(room.boundary.map((p) => new Vector2(p.x, -p.y))));
}
