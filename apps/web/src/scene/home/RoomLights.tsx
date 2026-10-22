import { bounds, centroid, contains, roomCeiling, roomMaterials } from '@roomie/geometry';
import type { Floorplan } from '@roomie/schema';
import { Color } from 'three';
import { kelvinToRgb } from './light';

/** Candela at full intensity: a bright ceiling fixture. */
const FULL = 5;
/** The light hangs this far below the ceiling. */
const DROP = 0.35;

/**
 * A ceiling light in each room, in its own warmth and brightness. They cast no shadows, so their
 * reach is cut off a little past the room to keep them from lighting the neighbours.
 */
export function RoomLights({ plan }: { plan: Floorplan }) {
  return plan.rooms.map((room) => {
    const { light } = roomMaterials(plan, room);
    if (light.intensity <= 0) return null;
    const { min, max } = bounds(room.boundary);
    // The centroid of an L-shaped room can fall outside it; then use the middle of its box.
    const middle = centroid(room.boundary);
    const at = contains(room.boundary, middle)
      ? middle
      : { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
    const reach = Math.hypot(max.x - min.x, max.y - min.y) / 2 + 1;
    return (
      <pointLight
        key={room.id}
        position={[at.x, roomCeiling(plan, room) - DROP, at.y]}
        color={new Color().setRGB(...kelvinToRgb(light.warmthK), 'srgb')}
        intensity={light.intensity * FULL}
        distance={reach}
        decay={2}
      />
    );
  });
}
