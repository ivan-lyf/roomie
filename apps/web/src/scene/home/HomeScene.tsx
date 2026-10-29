import { CameraControls, Environment } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { bounds } from '@roomie/geometry';
import type { Floorplan, Vec2 } from '@roomie/schema';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Object3D, Vector3 } from 'three';
import { Ceilings } from './Ceilings';
import { CUTAWAY_HEIGHT } from './cutaway';
import { Floors } from './Floors';
import { useFurnish } from '../../stores/furnish';
import { Furniture, useFloorEvents } from './Furniture';
import { preloadFloors } from './floorTextures';
import { Obstacles } from './Obstacles';
import { Openings, placedOpenings } from './Openings';
import { RoomLights } from './RoomLights';
import { useCutaway } from './useCutaway';
import { Walls, wallBoxes } from './Walls';

const BACKGROUND = '#f5f5f4';
/** The view starts from the south-east, looking down at about 35°. */
const AZIMUTH = 0.6;
const POLAR = 0.95;
/** Where the sun comes from: south-east, high up. */
const SUN = new Vector3(0.45, 1, 0.65).normalize();
/** A small CC0 indoor HDRI (see `apps/web/ASSETS.md`): soft daylight from every side. */
const ENVIRONMENT = '/env/lebombo-512.hdr';

/** What the camera frames: a point on the plan, and how far around it to show. */
type Extent = { center: Vec2; radius: number };

type Props = {
  plan: Floorplan;
  /** The room in view; the whole home when undefined. */
  roomId: string | undefined;
  onRoom: (roomId: string | undefined) => void;
  /** Lower the walls between the camera and the rooms in view. */
  cutaway: boolean;
  ceilings: boolean;
};

export function HomeScene({ plan, roomId, onRoom, cutaway, ceilings }: Props) {
  const boxes = useMemo(() => wallBoxes(plan), [plan]);
  const placed = useMemo(() => placedOpenings(plan), [plan]);
  const home = useMemo(() => extentOf(plan.walls.flatMap((w) => [w.a, w.b])), [plan]);
  const room = plan.rooms.find((r) => r.id === roomId);
  const focus = useMemo(() => (room ? extentOf(room.boundary) : home), [room, home]);
  const floorEvents = useFloorEvents(plan, onRoom);
  useEffect(preloadFloors, []);
  return (
    <Canvas
      shadows="percentage"
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 40, far: 300 }}
      onPointerMissed={() => {
        onRoom(undefined);
        useFurnish.getState().select(undefined);
      }}
    >
      <color attach="background" args={[BACKGROUND]} />
      <Suspense fallback={null}>
        <Environment files={ENVIRONMENT} environmentIntensity={0.75} />
      </Suspense>
      <Daylight home={home} />
      <RoomLights plan={plan} />
      <Floors plan={plan} {...floorEvents} />
      <CutAway
        plan={plan}
        boxes={boxes}
        placed={placed}
        roomId={room?.id}
        enabled={cutaway}
      />
      <Obstacles plan={plan} />
      <Furniture plan={plan} />
      {ceilings && <Ceilings plan={plan} />}
      <Ground home={home} />
      <Framing extent={focus} />
      <EffectComposer multisampling={4}>
        <N8AO aoRadius={0.5} distanceFalloff={0.5} intensity={2.5} halfRes />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      </EffectComposer>
    </Canvas>
  );
}

/**
 * The walls and openings, with those between the camera and the rooms in view cut down, like
 * the open front of a doll's house.
 */
function CutAway(props: {
  plan: Floorplan;
  boxes: ReturnType<typeof wallBoxes>;
  placed: ReturnType<typeof placedOpenings>;
  roomId: string | undefined;
  enabled: boolean;
}) {
  const { plan, boxes, placed, roomId, enabled } = props;
  const wallsInTheWay = useCutaway(boxes, roomId, enabled);
  const openingsInTheWay = useCutaway(placed, roomId, enabled);
  const lowered = useMemo(
    () => wallsInTheWay.map((cut) => (cut ? CUTAWAY_HEIGHT : undefined)),
    [wallsInTheWay],
  );
  const shown = useMemo(
    () => placed.filter((_, i) => !openingsInTheWay[i]),
    [placed, openingsInTheWay],
  );
  return (
    <>
      <Walls plan={plan} boxes={boxes} lowered={lowered} />
      <Openings plan={plan} placed={shown} />
    </>
  );
}

/** The middle of some points on the plan, and the radius that takes them all in. */
function extentOf(points: readonly Vec2[]): Extent {
  if (points.length === 0) return { center: { x: 0, y: 0 }, radius: 5 };
  const { min, max } = bounds(points);
  return {
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 },
    radius: Math.hypot(max.x - min.x, max.y - min.y) / 2,
  };
}

/** A sun, whose shadow covers the whole home; the environment fills in the rest. */
function Daylight({ home }: { home: Extent }) {
  const [target] = useState(() => new Object3D());
  const { center, radius } = home;
  const reach = radius + 2;
  const distance = reach + 20;
  return (
    <>
      <primitive object={target} position={[center.x, 0, center.y]} />
      <directionalLight
        target={target}
        position={[
          center.x + SUN.x * distance,
          SUN.y * distance,
          center.y + SUN.z * distance,
        ]}
        color="#fff4e6"
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={4}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-reach, reach, reach, -reach, distance - reach - 5, distance + reach + 5]}
        />
      </directionalLight>
    </>
  );
}

/** Catches the home's shadow, and is otherwise the background. */
function Ground({ home }: { home: Extent }) {
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[home.center.x, -0.002, home.center.y]}
      receiveShadow
    >
      <planeGeometry args={[200, 200]} />
      <shadowMaterial opacity={0.15} />
    </mesh>
  );
}

/**
 * Frames an extent: from the south-east at first, then from wherever the user has turned to,
 * gliding over when the extent changes.
 */
function Framing({ extent }: { extent: Extent }) {
  const controls = useRef<CameraControls>(null);
  const framed = useRef(false);
  const { center, radius } = extent;
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    // Aim a little above the floor, at the middle of the walls' height.
    const target = new Vector3(center.x, 1, center.y);
    const distance = c.getDistanceToFitSphere(Math.hypot(radius, 1.2));
    const azimuth = framed.current ? c.azimuthAngle : AZIMUTH;
    const p = new Vector3().setFromSphericalCoords(distance, POLAR, azimuth).add(target);
    void c.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, framed.current);
    framed.current = true;
  }, [center.x, center.y, radius]);
  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={1}
      maxDistance={80}
      maxPolarAngle={Math.PI / 2 - 0.05}
    />
  );
}
