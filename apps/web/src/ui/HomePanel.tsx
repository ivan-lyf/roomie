import { area } from '@roomie/geometry';
import type { Floorplan, RoomType } from '@roomie/schema';
import { LookControls } from './LookControls';

const ROOM_TYPES: Record<RoomType, string> = {
  living_room: 'Living room',
  bedroom: 'Bedroom',
  studio: 'Studio',
  dining_area: 'Dining area',
  den_office: 'Den or office',
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  hallway: 'Hallway',
  closet: 'Closet',
  laundry: 'Laundry',
  balcony: 'Balcony',
  other: 'Other',
};

const SQUARE_FEET_PER_SQUARE_METER = 10.7639;
const squareMeters = (m2: number) =>
  `${m2.toFixed(1)} m² · ${Math.round(m2 * SQUARE_FEET_PER_SQUARE_METER)} sq ft`;

type Props = {
  plan: Floorplan;
  roomId: string | undefined;
  onRoom: (roomId: string | undefined) => void;
  cutaway: boolean;
  onCutaway: (on: boolean) => void;
  ceilings: boolean;
  onCeilings: (on: boolean) => void;
};

export function HomePanel(props: Props) {
  const { plan, roomId, onRoom } = props;
  const total = plan.rooms.reduce((sum, room) => sum + area(room.boundary), 0);
  const item = (selected: boolean) =>
    `w-full px-3 py-2 text-left ${selected ? 'bg-stone-100' : 'hover:bg-stone-50'}`;
  return (
    <aside className="m-4 flex w-80 shrink-0 flex-col gap-3 overflow-y-auto rounded-xl bg-white p-4 text-sm text-stone-800 shadow-lg">
      <h1 className="text-base font-semibold">{plan.name}</h1>

      <ul className="divide-y divide-stone-200 rounded-md border border-stone-200">
        <li>
          <button type="button" onClick={() => onRoom(undefined)} className={item(!roomId)}>
            <span className="block font-medium">Whole home</span>
            <span className="block text-xs text-stone-500">
              {plan.rooms.length} rooms · {squareMeters(total)}
            </span>
          </button>
        </li>
        {plan.rooms.map((room) => (
          <li key={room.id}>
            <button
              type="button"
              onClick={() => onRoom(room.id)}
              className={item(room.id === roomId)}
            >
              <span className="block font-medium">{room.name}</span>
              <span className="block text-xs text-stone-500">
                {ROOM_TYPES[room.roomType]} · {squareMeters(area(room.boundary))}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <LookControls plan={plan} roomId={roomId} />

      <fieldset className="space-y-1">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.cutaway}
            onChange={(e) => props.onCutaway(e.target.checked)}
          />
          Lower the walls in front
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.ceilings}
            onChange={(e) => props.onCeilings(e.target.checked)}
          />
          Ceilings, seen from inside a room
        </label>
      </fieldset>

      <p className="text-xs text-stone-500">
        Click a room to look into it; Esc goes back to the whole home. Drag to turn, scroll to
        zoom.
      </p>
    </aside>
  );
}
