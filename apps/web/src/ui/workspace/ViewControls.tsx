import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useWorkspace } from '../../stores/workspace';
import { IconButton, Menu, MenuCheck, Toggle } from '../kit';

type Props = {
  roomId: string | undefined;
  /** The room to frame when "This room" is picked with none in view. */
  firstRoom: string | undefined;
  onRoom: (roomId: string | undefined) => void;
};

/** Floating under the 3D view: what to frame, 3D or from above, reset, and view options. */
export function ViewControls({ roomId, firstRoom, onRoom }: Props) {
  const { view, cutaway, ceilings, resets, set } = useWorkspace();
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      <div className="flex items-center gap-4 bg-surface px-3 py-1.5 shadow-panel">
        <Toggle
          label="What to show"
          value={roomId ? 'room' : 'home'}
          onChange={(v) => onRoom(v === 'home' ? undefined : (roomId ?? firstRoom))}
          options={[
            { value: 'home', label: 'Whole home' },
            { value: 'room', label: 'This room' },
          ]}
        />
        <span aria-hidden className="h-5 w-px bg-line" />
        <Toggle
          label="View"
          value={view}
          onChange={(v) => set({ view: v })}
          options={[
            { value: '3d', label: '3D' },
            { value: 'top', label: 'Top view' },
          ]}
        />
        <span aria-hidden className="h-5 w-px bg-line" />
        <IconButton label="Reset the view" onClick={() => set({ resets: resets + 1 })}>
          <RotateCcw size={18} aria-hidden />
        </IconButton>
        <Menu
          trigger={
            <button
              type="button"
              className="flex items-center gap-1.5 px-2 py-1 font-mono text-sm text-ink-muted hover:text-ink"
            >
              <SlidersHorizontal size={16} aria-hidden />
              View options
            </button>
          }
        >
          <MenuCheck checked={cutaway} onChange={(on) => set({ cutaway: on })}>
            Lower the walls in front
          </MenuCheck>
          <MenuCheck checked={ceilings} onChange={(on) => set({ ceilings: on })}>
            Show ceilings
          </MenuCheck>
        </Menu>
      </div>
      <p className="m-0 bg-canvas/80 px-2 font-mono text-xs text-ink-muted">
        Drag to look around · Scroll to zoom
      </p>
    </div>
  );
}
