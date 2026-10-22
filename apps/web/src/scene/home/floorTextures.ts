import { useTexture } from '@react-three/drei';
import { FloorMaterial } from '@roomie/schema';
import { useCallback } from 'react';
import { NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * The floor textures in `public/textures/floor` (CC0, from Poly Haven; see `apps/web/ASSETS.md`):
 * how many meters one tile of each covers, a name, and a flat color to show while it loads.
 */
export const FLOORS: Record<FloorMaterial, { size: number; name: string; color: string }> = {
  light_oak: { size: 1.7, name: 'Light oak', color: '#c9a97f' },
  dark_oak: { size: 1.7, name: 'Dark oak', color: '#7a5236' },
  tile: { size: 1.5, name: 'Stone tile', color: '#d9d3c7' },
  concrete: { size: 3, name: 'Concrete', color: '#8e8c87' },
  carpet: { size: 0.27, name: 'Carpet', color: '#8b8883' },
};

export const floorColorUrl = (floor: FloorMaterial) => `/textures/floor/${floor}_color.jpg`;
const floorRoughnessUrl = (floor: FloorMaterial) => `/textures/floor/${floor}_rough.jpg`;

/** Starts loading every floor texture, so switching floors doesn't flash. */
export function preloadFloors() {
  for (const floor of FloorMaterial.options) {
    useTexture.preload(floorColorUrl(floor));
    useTexture.preload(floorRoughnessUrl(floor));
  }
}

/**
 * A floor's color and roughness maps, tiled at their real size: floor UVs are plan meters.
 * Suspends while they load.
 */
export function useFloorTextures(floor: FloorMaterial): { map: Texture; roughnessMap: Texture } {
  const configure = useCallback(
    (textures: Record<string, Texture>) => {
      for (const [key, t] of Object.entries(textures)) {
        t.colorSpace = key === 'map' ? SRGBColorSpace : NoColorSpace;
        t.wrapS = t.wrapT = RepeatWrapping;
        t.repeat.setScalar(1 / FLOORS[floor].size);
        t.anisotropy = 8;
        t.needsUpdate = true;
      }
    },
    [floor],
  );
  return useTexture(
    { map: floorColorUrl(floor), roughnessMap: floorRoughnessUrl(floor) },
    configure,
  );
}
