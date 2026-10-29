import type { Room, Vec2 } from '@roomie/schema';
import { DEFAULT_SILL_HEIGHT } from '../plan/heights';
import { area, interiorPoint, signedArea } from '../plan/polygon';
import { edgeInsets, floorPolygon, roomsBeside } from '../plan/rooms';
import { pointAlong, wallLength } from '../plan/walls';
import type { LayoutPlan } from './validate';

// A room as furnishing sees it: its floor, the faces of its walls, its windows and its doors.

/** A wall's face along a room's floor: where it starts, its direction, length and the way in. */
export type Face = {
  p: Vec2;
  d: Vec2;
  length: number;
  inward: Vec2;
  /** Windows along it, as distances from `p` to each one's ends, and their sills. */
  windows: { from: number; to: number; sill: number }[];
};

export type Window = { center: Vec2; width: number; sill: number };

export type RoomContext = {
  room: Room;
  floor: Vec2[];
  /** The faces of walls; sides open to the next room have none. */
  faces: Face[];
  windows: Window[];
  /** The middle of each door and open doorway into the room. */
  doors: Vec2[];
  /** The floor just past each side open to the next room, 60 cm deep. */
  beyond: Vec2[][];
  center: Vec2;
  area: number;
};

const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;

/** Openings whose wall bounds the room, with the room on one side of them. */
function openingsOf(plan: LayoutPlan, room: Room) {
  return plan.openings.flatMap((o) => {
    const wall = plan.walls.find((w) => w.id === o.wallId);
    if (!wall) return [];
    const beside = roomsBeside(wall, o.offset + o.width / 2, plan.rooms);
    if (beside.left?.id !== room.id && beside.right?.id !== room.id) return [];
    return [{ opening: o, wall, center: pointAlong(wall, o.offset + o.width / 2) }];
  });
}

export function roomContext(plan: LayoutPlan, roomId: string): RoomContext | undefined {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return undefined;
  const floor = floorPolygon(room.boundary, plan.walls);
  const insets = edgeInsets(room.boundary, plan.walls);
  const clockwise = signedArea(floor) > 0;
  const openings = openingsOf(plan, room);

  const faces: Face[] = [];
  const beyond: Vec2[][] = [];
  floor.forEach((p, i) => {
    const q = floor[(i + 1) % floor.length]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length < 1e-9) return;
    const d = { x: (q.x - p.x) / length, y: (q.y - p.y) / length };
    const inward = clockwise ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
    if (insets[i]! <= 0) {
      const out = (v: Vec2) => ({ x: v.x - inward.x * 0.6, y: v.y - inward.y * 0.6 });
      beyond.push([p, q, out(q), out(p)]);
      return;
    }
    const windows = openings
      .filter(({ opening, wall, center }) => {
        const rel = { x: center.x - p.x, y: center.y - p.y };
        const across = Math.abs(dot(rel, inward));
        const along = dot(rel, d);
        return (
          opening.kind === 'window' &&
          across <= wall.thickness / 2 + 0.05 &&
          along >= 0 &&
          along <= length &&
          Math.abs(dot(d, { x: wall.b.x - wall.a.x, y: wall.b.y - wall.a.y })) >
            0.99 * wallLength(wall)
        );
      })
      .map(({ opening, center }) => {
        const along = dot({ x: center.x - p.x, y: center.y - p.y }, d);
        const sill = opening.sillHeight ?? DEFAULT_SILL_HEIGHT;
        return { from: along - opening.width / 2, to: along + opening.width / 2, sill };
      });
    faces.push({ p, d, length, inward, windows });
  });

  return {
    room,
    floor,
    faces,
    windows: openings
      .filter(({ opening }) => opening.kind === 'window')
      .map(({ opening, center }) => ({
        center,
        width: opening.width,
        sill: opening.sillHeight ?? DEFAULT_SILL_HEIGHT,
      })),
    doors: openings.filter(({ opening }) => opening.kind !== 'window').map((o) => o.center),
    beyond,
    center: interiorPoint(floor),
    area: area(floor),
  };
}
