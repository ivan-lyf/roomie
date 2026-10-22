import {
  DEFAULT_SILL_HEIGHT,
  doorSwing,
  pointAlong,
  roomsBeside,
  wallDirection,
  wallHeight,
  wallLength,
} from '@roomie/geometry';
import type { Floorplan, Opening, Room, Vec2, Wall } from '@roomie/schema';
import { useEffect, useMemo } from 'react';
import { Color } from 'three';
import { MeshBuilder, type PlanBox } from './meshBuilder';

/** Width of a window or door frame's profile. */
const FRAME = 0.05;
/** How deep a window frame is, centered in the wall. */
const WINDOW_FRAME_DEPTH = 0.08;
/** Door frames stand this much proud of each side of the wall. */
const DOOR_FRAME_PROUD = 0.01;
const LEAF_THICKNESS = 0.04;
/** Windows wider than this get a mullion down the middle. */
const MULLION_OVER = 1.2;
const TRIM = new Color('#f7f5f0');
const GLASS = new Color('#dbe9f0');

/** An opening on its wall, with the rooms on each side of it. */
export type PlacedOpening = {
  opening: Opening;
  wall: Wall;
  center: Vec2;
  left?: Room;
  right?: Room;
};

export function placedOpenings(plan: Floorplan): PlacedOpening[] {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  return plan.openings.flatMap((opening) => {
    const wall = walls.get(opening.wallId);
    if (!wall) return [];
    const middle = opening.offset + opening.width / 2;
    return [
      {
        opening,
        wall,
        center: pointAlong(wall, middle),
        ...roomsBeside(wall, middle, plan.rooms),
      },
    ];
  });
}

/** Window frames and glass, door frames, and door leaves standing open on their swing side. */
export function Openings({ plan, placed }: { plan: Floorplan; placed: readonly PlacedOpening[] }) {
  const { trim, glass } = useMemo(() => {
    const trim = new MeshBuilder();
    const glass = new MeshBuilder();
    for (const { opening, wall } of placed) {
      // The same clamping as the gap in the wall.
      const start = Math.max(0, opening.offset);
      const end = Math.min(wallLength(wall), opening.offset + opening.width);
      if (end - start <= 2 * FRAME) continue;
      const d = wallDirection(wall);
      const piece = (
        from: number,
        to: number,
        bottom: number,
        top: number,
        width: number,
      ): PlanBox => ({
        center: pointAlong(wall, (from + to) / 2),
        direction: d,
        length: to - from,
        width,
        bottom,
        top,
      });
      const all = (c: Color) => () => c;
      const height = wallHeight(plan, wall);

      if (opening.kind === 'window') {
        const sill = Math.min(opening.sillHeight ?? DEFAULT_SILL_HEIGHT, height);
        const head = Math.min(sill + opening.height, height);
        const depth = Math.min(WINDOW_FRAME_DEPTH, wall.thickness);
        for (const box of [
          piece(start, start + FRAME, sill, head, depth),
          piece(end - FRAME, end, sill, head, depth),
          piece(start, end, sill, sill + FRAME, depth),
          piece(start, end, head - FRAME, head, depth),
        ]) {
          trim.box(box, all(TRIM));
        }
        const middle = (start + end) / 2;
        if (end - start > MULLION_OVER) {
          trim.box(piece(middle - FRAME / 2, middle + FRAME / 2, sill, head, depth), all(TRIM));
        }
        glass.box(piece(start, end, sill + FRAME, head - FRAME, 0.012), all(GLASS));
      } else if (opening.kind === 'door') {
        const top = Math.min(opening.height, height);
        const depth = wall.thickness + 2 * DOOR_FRAME_PROUD;
        for (const box of [
          piece(start, start + FRAME, 0, top, depth),
          piece(end - FRAME, end, 0, top, depth),
          piece(start, end, top - FRAME, top, depth),
        ]) {
          trim.box(box, (face) => (face === 'bottom' ? undefined : TRIM));
        }
        const swing = doorSwing(wall, opening);
        if (swing) trim.box(leaf(swing, wall.thickness, end - start, top), all(TRIM));
      }
    }
    return { trim: trim.build(), glass: glass.build() };
  }, [plan, placed]);
  useEffect(
    () => () => {
      trim.dispose();
      glass.dispose();
    },
    [trim, glass],
  );

  return (
    <>
      <mesh geometry={trim} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.5} />
      </mesh>
      <mesh geometry={glass}>
        <meshStandardMaterial
          vertexColors
          transparent
          opacity={0.3}
          roughness={0.05}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

/**
 * A door leaf open at 90°: hinged inside the frame on the swing side of the wall, and standing
 * out into the room it swings into.
 */
function leaf(
  swing: NonNullable<ReturnType<typeof doorSwing>>,
  wallThickness: number,
  width: number,
  height: number,
): PlanBox {
  const { hinge, closed, open } = swing;
  const length = width - 2 * FRAME;
  const out = wallThickness / 2 + length / 2;
  const aside = FRAME + LEAF_THICKNESS / 2;
  return {
    center: {
      x: hinge.x + open.x * out + closed.x * aside,
      y: hinge.y + open.y * out + closed.y * aside,
    },
    direction: open,
    length,
    width: LEAF_THICKNESS,
    bottom: 0.01,
    top: height - FRAME - 0.005,
  };
}
