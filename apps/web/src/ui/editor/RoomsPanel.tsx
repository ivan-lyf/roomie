import { area } from '@roomie/geometry';
import { type Floorplan, RoomType } from '@roomie/schema';
import { formatLength, ROOM_TYPES, squareMeters } from '../../format';
import { useEditor } from '../../stores/editor';
import { useFloorplan } from '../../stores/floorplan';
import { LengthInput } from './inputs';

const SOURCES = { user: 'set by you', plan: 'read from the plan', default: 'the usual 8 ft' };

/** Each room's name, type, furnishing and ceiling, and the home's ceiling. */
export function RoomsPanel({ plan }: { plan: Floorplan }) {
  const { selection, select, imperial } = useEditor();
  const store = useFloorplan.getState();
  return (
    <div className="flex flex-col gap-3">
      <label className="grid grid-cols-[6rem_1fr] items-center gap-2">
        <span className="text-stone-500">Ceiling</span>
        <LengthInput value={plan.ceilingHeight} imperial={imperial} onChange={store.setCeiling} />
        <span />
        <span className="text-xs text-stone-500">
          {formatLength(plan.ceilingHeight, imperial)}, {SOURCES[plan.ceilingHeightSource]}
        </span>
      </label>

      {plan.rooms.length === 0 && (
        <p className="text-xs text-stone-500">No rooms yet: use the Room tool to outline one.</p>
      )}
      <ul className="flex flex-col gap-2">
        {plan.rooms.map((room) => {
          const selected = selection.includes(room.id);
          return (
            <li
              key={room.id}
              onClick={() => select([room.id])}
              className={`flex flex-col gap-1.5 rounded-md border p-2 ${
                selected ? 'border-rose-500 bg-rose-50' : 'border-stone-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  key={room.name}
                  defaultValue={room.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== room.name) store.setRoom(room.id, { name });
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1 font-medium"
                />
                <span className="shrink-0 text-xs text-stone-500">
                  {squareMeters(area(room.boundary))}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={room.roomType}
                  onChange={(e) =>
                    store.setRoom(room.id, { roomType: RoomType.parse(e.target.value) })
                  }
                  className="min-w-0 flex-1 rounded border border-stone-300 px-1 py-1"
                >
                  {RoomType.options.map((t) => (
                    <option key={t} value={t}>
                      {ROOM_TYPES[t]}
                    </option>
                  ))}
                </select>
                <label className="flex shrink-0 items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={room.furnishable}
                    onChange={(e) => store.setRoom(room.id, { furnishable: e.target.checked })}
                  />
                  Furnish
                </label>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="shrink-0 text-stone-500">Ceiling</span>
                <LengthInput
                  value={room.ceilingHeight}
                  placeholder={`${formatLength(plan.ceilingHeight, imperial)}, like the home`}
                  imperial={imperial}
                  onChange={(h) => store.setRoom(room.id, { ceilingHeight: h })}
                  className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-0.5"
                />
                {room.ceilingHeight !== undefined && (
                  <button
                    type="button"
                    onClick={() => store.setRoom(room.id, { ceilingHeight: undefined })}
                    className="shrink-0 underline"
                  >
                    Reset
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
