import { roomMaterials } from '@roomie/geometry';
import { FloorMaterial, type Floorplan } from '@roomie/schema';
import { FLOORS, floorColorUrl } from '../scene/home/floorTextures';
import { warmthLabel } from '../scene/home/light';
import { useFloorplan } from '../stores/floorplan';

/** Paint colors to start from; any other can be picked. */
const PAINTS: [string, string][] = [
  ['Warm white', '#f3efe7'],
  ['Bright white', '#fafaf9'],
  ['Greige', '#ddd5c8'],
  ['Sage', '#c8d2bf'],
  ['Mist blue', '#cdd9e1'],
  ['Blush', '#ead7cf'],
  ['Clay', '#c9a48d'],
  ['Charcoal', '#55524e'],
];

/**
 * Wall color, floor and light for the whole home, or with a room picked, for that room only:
 * a room's changes override the home's until it's reset.
 */
export function LookControls({ plan, roomId }: { plan: Floorplan; roomId: string | undefined }) {
  const setMaterials = useFloorplan((s) => s.setMaterials);
  const resetRoomMaterials = useFloorplan((s) => s.resetRoomMaterials);
  const room = plan.rooms.find((r) => r.id === roomId);
  const look = room ? roomMaterials(plan, room) : plan.materials;
  const set = (change: Parameters<typeof setMaterials>[1]) => setMaterials(room?.id, change);
  const own = room?.materials && Object.keys(room.materials).length > 0;

  return (
    <section className="space-y-3 border-t border-stone-200 pt-3">
      <header className="flex items-baseline justify-between">
        <h2 className="font-medium">
          Look of {room ? room.name.toLowerCase() : 'the whole home'}
        </h2>
        {room && own && (
          <button
            type="button"
            className="text-xs text-stone-500 underline"
            onClick={() => resetRoomMaterials(room.id)}
          >
            Same as home
          </button>
        )}
      </header>

      <div>
        <p className="mb-1 text-xs text-stone-500">Walls</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {PAINTS.map(([name, hex]) => (
            <button
              key={hex}
              type="button"
              title={name}
              aria-label={name}
              onClick={() => set({ wallColor: hex })}
              className={`h-6 w-6 rounded-full border ${
                look.wallColor === hex ? 'ring-2 ring-stone-800 ring-offset-1' : 'border-stone-300'
              }`}
              style={{ background: hex }}
            />
          ))}
          <input
            type="color"
            aria-label="Another wall color"
            value={look.wallColor}
            onChange={(e) => set({ wallColor: e.target.value })}
            className="h-6 w-8 cursor-pointer"
          />
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-stone-500">Floor</p>
        <div className="grid grid-cols-5 gap-1.5">
          {FloorMaterial.options.map((floor) => (
            <button
              key={floor}
              type="button"
              onClick={() => set({ floor })}
              className="text-center text-[11px] leading-tight"
            >
              <span
                className={`mb-0.5 block aspect-square rounded-md bg-cover ${
                  look.floor === floor ? 'ring-2 ring-stone-800 ring-offset-1' : ''
                }`}
                style={{ backgroundImage: `url(${floorColorUrl(floor)})` }}
              />
              {FLOORS[floor].name}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 flex justify-between text-xs text-stone-500">
          <span>Light color</span>
          <span>
            {look.light.warmthK} K · {warmthLabel(look.light.warmthK)}
          </span>
        </span>
        <input
          type="range"
          min={2700}
          max={6500}
          step={100}
          value={look.light.warmthK}
          onChange={(e) => set({ light: { ...look.light, warmthK: Number(e.target.value) } })}
          className="w-full accent-stone-800"
        />
      </label>

      <label className="block">
        <span className="mb-1 flex justify-between text-xs text-stone-500">
          <span>Lights</span>
          <span>
            {look.light.intensity === 0 ? 'off' : `${Math.round(look.light.intensity * 100)}%`}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={look.light.intensity}
          onChange={(e) => set({ light: { ...look.light, intensity: Number(e.target.value) } })}
          className="w-full accent-stone-800"
        />
      </label>
    </section>
  );
}
