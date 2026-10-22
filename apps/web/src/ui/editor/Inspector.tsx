import { obstacleHeight, wallHeight, wallLength } from '@roomie/geometry';
import { type Floorplan, ObstacleKind } from '@roomie/schema';
import { formatLength } from '../../format';
import { useEditor } from '../../stores/editor';
import { useFloorplan } from '../../stores/floorplan';
import { LengthInput } from './inputs';
import { FIXTURES } from './Toolbar';

const KINDS = { door: 'Door', window: 'Window', passage: 'Passage' } as const;

/** The numbers of what's selected, to type exact values. */
export function Inspector({ plan }: { plan: Floorplan }) {
  const { selection, imperial, select } = useEditor();
  const store = useFloorplan.getState();
  if (selection.length === 0) {
    return <p className="text-xs text-stone-500">Select a wall, opening or fixture to edit it.</p>;
  }

  const remove = (
    <button
      type="button"
      onClick={() => {
        store.remove(selection);
        select([]);
      }}
      className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
    >
      Delete <kbd className="opacity-60">Del</kbd>
    </button>
  );

  if (selection.length > 1) {
    const rooms = selection.filter((id) => plan.rooms.some((r) => r.id === id));
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-stone-500">{selection.length} selected</span>
        {rooms.length === 2 && (
          <button
            type="button"
            onClick={() => {
              if (store.mergeRooms(rooms[0]!, rooms[1]!)) select([rooms[0]!]);
            }}
            className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
          >
            Merge rooms
          </button>
        )}
        {remove}
      </div>
    );
  }

  const id = selection[0]!;
  const row = 'grid grid-cols-[6rem_1fr] items-center gap-2';
  const wall = plan.walls.find((w) => w.id === id);
  if (wall) {
    const length = wallLength(wall);
    return (
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Wall</h3>
        <div className={row}>
          <span className="text-stone-500">Length</span>
          <span>{formatLength(length, imperial)}</span>
          <span className="text-stone-500">Thickness</span>
          <LengthInput
            value={wall.thickness}
            imperial={imperial}
            precise
            onChange={(t) => store.setWallThickness(wall.id, t)}
          />
          <span className="text-stone-500">Height</span>
          <span>{formatLength(wallHeight(plan, wall), imperial)} (its rooms&apos; ceiling)</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => store.splitWall(wall.id, length / 2)}
            className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
          >
            Split in the middle
          </button>
          {remove}
        </div>
      </div>
    );
  }

  const opening = plan.openings.find((o) => o.id === id);
  if (opening) {
    const set = (change: Parameters<typeof store.setOpening>[1]) =>
      store.setOpening(opening.id, change);
    return (
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">{KINDS[opening.kind]}</h3>
        <div className={row}>
          <span className="text-stone-500">Width</span>
          <LengthInput
            value={opening.width}
            imperial={imperial}
            onChange={(width) => set({ width })}
          />
          <span className="text-stone-500">Height</span>
          <LengthInput
            value={opening.height}
            imperial={imperial}
            onChange={(height) => set({ height })}
          />
          {opening.kind === 'window' && (
            <>
              <span className="text-stone-500">Sill</span>
              <LengthInput
                value={opening.sillHeight}
                imperial={imperial}
                onChange={(sillHeight) => set({ sillHeight })}
              />
            </>
          )}
          <span className="text-stone-500">From wall end</span>
          <LengthInput
            value={opening.offset}
            imperial={imperial}
            onChange={(offset) => set({ offset })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {opening.swing && (
            <>
              <button
                type="button"
                onClick={() => store.flipHinge(opening.id)}
                className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
              >
                Flip hinge
              </button>
              <button
                type="button"
                onClick={() => store.flipSide(opening.id)}
                className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
              >
                Swing the other way
              </button>
            </>
          )}
          {remove}
        </div>
      </div>
    );
  }

  const obstacle = plan.obstacles.find((o) => o.id === id);
  if (obstacle) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Fixture</h3>
        <div className={row}>
          <span className="text-stone-500">Kind</span>
          <select
            value={obstacle.kind}
            onChange={(e) =>
              store.setObstacle(obstacle.id, { kind: ObstacleKind.parse(e.target.value) })
            }
            className="rounded border border-stone-300 px-1 py-1"
          >
            {ObstacleKind.options.map((k) => (
              <option key={k} value={k}>
                {FIXTURES[k]}
              </option>
            ))}
          </select>
          <span className="text-stone-500">Height</span>
          <LengthInput
            value={obstacle.height}
            placeholder={`${formatLength(obstacleHeight(plan, obstacle), imperial)} by default`}
            imperial={imperial}
            onChange={(height) => store.setObstacle(obstacle.id, { height })}
          />
        </div>
        <div className="flex gap-2">
          {obstacle.height !== undefined && (
            <button
              type="button"
              onClick={() => store.setObstacle(obstacle.id, { height: undefined })}
              className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
            >
              Default height
            </button>
          )}
          {remove}
        </div>
      </div>
    );
  }

  const room = plan.rooms.find((r) => r.id === id);
  return room ? (
    <div className="flex items-center gap-2">
      <span className="text-xs text-stone-500">{room.name}: edit it under Rooms.</span>
      {remove}
    </div>
  ) : null;
}
