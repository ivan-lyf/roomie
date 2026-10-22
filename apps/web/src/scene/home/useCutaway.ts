import { useFrame, useThree } from '@react-three/fiber';
import { useState } from 'react';
import { inTheWay, type Stretch } from './cutaway';

/**
 * Which stretches of wall are in the way from where the camera is now (see `inTheWay`). It's
 * checked every frame, but only changes, and re-renders, when the camera crosses a wall's line
 * or the room in view changes.
 */
export function useCutaway(
  stretches: readonly Stretch[],
  roomId: string | undefined,
  enabled: boolean,
): readonly boolean[] {
  const camera = useThree((s) => s.camera);
  const [flags, setFlags] = useState<readonly boolean[]>([]);
  useFrame(() => {
    const at = { x: camera.position.x, y: camera.position.z };
    const next = stretches.map((s) => enabled && inTheWay(s, roomId, at));
    if (next.length !== flags.length || next.some((f, i) => f !== flags[i])) setFlags(next);
  });
  return flags;
}
