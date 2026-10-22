import {
  roomMaterials,
  roomsBeside,
  wallBreaks,
  wallDirection,
  wallHeight,
  wallPieces,
  type WallPiece,
} from '@roomie/geometry';
import type { Floorplan, Room, Wall } from '@roomie/schema';
import { useEffect, useMemo } from 'react';
import { Color } from 'three';
import { MeshBuilder } from './meshBuilder';

/** The cut top of a wall, which draws the plan when seen from above. */
const TOP = '#a8a198';
/** Window sills, the underside of lintels, and the edges of openings. */
const TRIM = '#f4f1ea';
/** The outside of the home. */
const OUTSIDE = '#e7e5e4';

/** A box of wall with the room on each side of it; none on the outside of the home. */
export type WallBox = WallPiece & { wall: Wall; height: number; left?: Room; right?: Room };

/** Every box of every wall, cut where the rooms beside the wall change. */
export function wallBoxes(plan: Floorplan): WallBox[] {
  return plan.walls.flatMap((wall) => {
    const height = wallHeight(plan, wall);
    const pieces = wallPieces(wall, plan.openings, height, wallBreaks(wall, plan.rooms));
    return pieces.map((piece) => ({
      ...piece,
      wall,
      height,
      ...roomsBeside(wall, (piece.from + piece.to) / 2, plan.rooms),
    }));
  });
}

type Props = {
  plan: Floorplan;
  boxes: readonly WallBox[];
  /** Boxes cut down to this height, by index; the others stand full height. */
  lowered?: readonly (number | undefined)[];
};

const FULL_HEIGHT: readonly undefined[] = [];

/** All the walls as one mesh, each side painted in the color of the room it faces. */
export function Walls({ plan, boxes, lowered = FULL_HEIGHT }: Props) {
  const geometry = useMemo(() => {
    const colors = new Map<string, Color>();
    const color = (hex: string) => colors.get(hex) ?? colors.set(hex, new Color(hex)).get(hex)!;
    const side = (room: Room | undefined) =>
      color(room ? roomMaterials(plan, room).wallColor : OUTSIDE);
    const builder = new MeshBuilder();
    boxes.forEach((box, i) => {
      const cut = lowered[i];
      const top = cut === undefined ? box.top : Math.min(box.top, cut);
      if (top - box.bottom < 1e-6) return;
      // A window sill's top is trim; the wall's own top, even cut down, shows the plan.
      const topColor = cut !== undefined || box.top >= box.height - 1e-6 ? TOP : TRIM;
      const [left, right] = [side(box.left), side(box.right)];
      builder.box(
        {
          center: box.center,
          direction: wallDirection(box.wall),
          length: box.length,
          width: box.thickness,
          bottom: box.bottom,
          top,
        },
        (face) => {
          if (face === 'left') return left;
          if (face === 'right') return right;
          if (face === 'top') return color(topColor);
          // Bottoms are only seen under lintels; on the floor they never are.
          if (face === 'bottom') return box.bottom > 0 ? color(TRIM) : undefined;
          return color(TRIM);
        },
      );
    });
    return builder.build();
  }, [plan, boxes, lowered]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    // Walls catch clicks, so clicking one doesn't pick the room whose floor is behind it.
    <mesh geometry={geometry} castShadow receiveShadow onClick={(e) => e.stopPropagation()}>
      <meshStandardMaterial vertexColors roughness={0.9} />
    </mesh>
  );
}
