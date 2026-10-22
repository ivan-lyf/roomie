import { leftNormal, wallDirection } from '@roomie/geometry';
import type { Room, Vec2, Wall } from '@roomie/schema';

/** Walls in the way drop to this height, leaving their outline on the floor. */
export const CUTAWAY_HEIGHT = 0.15;

/** A stretch of wall: a point on it, and the rooms on each side there (see `roomsBeside`). */
export type Stretch = { wall: Wall; center: Vec2; left?: Room; right?: Room };

/**
 * Whether a stretch of wall blocks the view, like the open front of a doll's house. Looking at
 * the whole home, that's an outside wall with the camera outside it. Looking at one room, only
 * the room's own walls on its far side stay up, as a backdrop; every other wall is in the way.
 * `camera` is the camera's position over the plan.
 */
export function inTheWay(stretch: Stretch, roomId: string | undefined, camera: Vec2): boolean {
  const n = leftNormal(wallDirection(stretch.wall));
  const cameraLeft = (camera.x - stretch.center.x) * n.x + (camera.y - stretch.center.y) * n.y > 0;
  const inView = (room: Room | undefined) =>
    room !== undefined && (roomId === undefined || room.id === roomId);
  const [left, right] = [inView(stretch.left), inView(stretch.right)];
  // The rooms in view are on the camera's side of a wall bounding them: it's behind them.
  const behind = left !== right && left === cameraLeft;
  return roomId === undefined ? left !== right && !behind : !behind;
}
