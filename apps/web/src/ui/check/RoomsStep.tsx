import { FURNISHABLE, type Floorplan, type RoomType } from '@roomie/schema';
import { useState } from 'react';
import { roomSides } from '../../check';
import { ROOM_ICONS } from '../../copy';
import { formatSides, ROOM_TYPES } from '../../format';
import { useFloorplan } from '../../stores/floorplan';
import { Button, Notice } from '../kit';
import type { Highlight } from './PlanSheet';
import { useHighlight } from './highlight';

type Props = {
  plan: Floorplan;
  imperial: boolean;
  onHighlight: (h: Highlight) => void;
  next: () => void;
};

/** Step 2, the rooms: what each is for, and which are really one (§4.3). */
export function RoomsStep({ plan, imperial, onHighlight, next }: Props) {
  const setRoom = useFloorplan((s) => s.setRoom);
  const mergeRooms = useFloorplan((s) => s.mergeRooms);
  const [picked, setPicked] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string>();
  const [error, setError] = useState<string>();
  useHighlight(onHighlight, { rooms: true, ...((hovered ?? picked[0]) && { room: hovered ?? picked[0] }) });

  const pick = (id: string, on: boolean) => {
    setError(undefined);
    setPicked(on ? [...picked.filter((p) => p !== id), id].slice(-2) : picked.filter((p) => p !== id));
  };
  const merge = () => {
    const [keep, other] = picked;
    if (!keep || !other) return;
    if (mergeRooms(keep, other)) setPicked([]);
    else setError("Those two don't touch, so they can't be one room.");
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="m-0 text-2xl font-semibold">Are these your rooms?</h1>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {plan.rooms.map((room) => {
          const Icon = ROOM_ICONS[room.roomType];
          const { width, depth } = roomSides(plan, room.boundary);
          const furnished = FURNISHABLE.has(room.roomType) && room.furnishable;
          return (
            <li
              key={room.id}
              onMouseEnter={() => setHovered(room.id)}
              onMouseLeave={() => setHovered(undefined)}
              className="flex flex-col gap-1.5 border border-line px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  aria-label={`Pick ${room.name}, to join it with another room`}
                  checked={picked.includes(room.id)}
                  onChange={(e) => pick(room.id, e.target.checked)}
                  className="size-4 accent-accent"
                />
                <Icon size={20} aria-hidden className="shrink-0 text-ink-muted" />
                <input
                  key={room.name}
                  defaultValue={room.name}
                  aria-label={`Name of ${room.name}`}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== room.name) setRoom(room.id, { name });
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="min-w-0 flex-1 rounded-control border border-transparent px-1 font-semibold hover:border-line"
                />
                <select
                  value={room.roomType}
                  aria-label={`What ${room.name} is for`}
                  onChange={(e) => setRoom(room.id, { roomType: e.target.value as RoomType })}
                  className="rounded-control border border-line-strong bg-surface px-2 py-1.5 text-sm"
                >
                  {(Object.keys(ROOM_TYPES) as RoomType[]).map((t) => (
                    <option key={t} value={t}>
                      {ROOM_TYPES[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3 pl-[3.25rem]">
                <span className="font-mono text-sm text-ink-muted">
                  {formatSides(width, depth, imperial)}
                </span>
                {furnished && (
                  <span className="bg-ok-tint px-2 py-0.5 text-[13px] font-semibold text-ok">
                    We&apos;ll furnish this
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {picked.length === 2 && (
        <Button variant="secondary" className="self-start" onClick={merge}>
          These are one room
        </Button>
      )}
      {picked.length === 1 && (
        <p className="m-0 text-sm text-ink-muted">Pick one more to join them into one room.</p>
      )}
      {error && <Notice tone="warn">{error}</Notice>}
      <p className="m-0 text-sm leading-normal text-ink-muted">
        We furnish living rooms, bedrooms, studios, dining areas and dens. Kitchens and bathrooms are
        shown, but left as they are.
      </p>
      <Button className="self-start" onClick={next}>
        These are right
      </Button>
    </div>
  );
}
