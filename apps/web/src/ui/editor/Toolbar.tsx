import { ObstacleKind } from '@roomie/schema';
import { useStore } from 'zustand';
import { useEditor, type Tool } from '../../stores/editor';
import { redo, undo, useFloorplan } from '../../stores/floorplan';
import { LengthInput } from './inputs';

/** The tools, with their keys. */
export const TOOLS: { tool: Tool; label: string; key: string; hint: string }[] = [
  { tool: 'select', label: 'Select', key: 'v', hint: 'Click to select, drag points and walls' },
  {
    tool: 'wall',
    label: 'Wall',
    key: 'w',
    hint: 'Click corner to corner; Esc or a second click ends',
  },
  { tool: 'door', label: 'Door', key: 'd', hint: 'Click a wall' },
  { tool: 'window', label: 'Window', key: 'n', hint: 'Click a wall' },
  { tool: 'passage', label: 'Passage', key: 'p', hint: 'An opening with no door: click a wall' },
  { tool: 'room', label: 'Room', key: 'r', hint: 'Click its corners; click the first to close' },
  { tool: 'split', label: 'Split room', key: 's', hint: 'Draw a line across a room' },
  { tool: 'obstacle', label: 'Fixture', key: 'o', hint: 'Drag a box: counters, closets, columns' },
  { tool: 'measure', label: 'Scale', key: 'm', hint: 'Measure something to set the scale' },
];

export const FIXTURES: Record<ObstacleKind, string> = {
  counter: 'Counter',
  appliance: 'Appliance',
  closet: 'Built-in closet',
  column: 'Column',
  radiator: 'Radiator',
  fireplace: 'Fireplace',
  other: 'Other',
};

export function Toolbar({ calibrated }: { calibrated: boolean }) {
  const { tool, setTool, wallThickness, obstacleKind, imperial, set } = useEditor();
  const canUndo = useStore(useFloorplan.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useFloorplan.temporal, (s) => s.futureStates.length > 0);
  const button = (on: boolean) =>
    `flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left disabled:opacity-40 ${
      on ? 'bg-stone-800 text-white' : 'hover:bg-stone-100'
    }`;
  const current = TOOLS.find((t) => t.tool === tool);

  return (
    <nav className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-stone-200 bg-white p-2 text-sm">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          title={t.hint}
          disabled={!calibrated && t.tool !== 'measure'}
          onClick={() => setTool(t.tool)}
          className={button(tool === t.tool)}
        >
          {t.label}
          <kbd className="text-xs opacity-60">{t.key.toUpperCase()}</kbd>
        </button>
      ))}
      {current && <p className="px-2 py-1 text-xs text-stone-500">{current.hint}.</p>}

      {tool === 'wall' && (
        <label className="flex flex-col gap-1 px-2 text-xs text-stone-600">
          Thickness
          <LengthInput
            value={wallThickness}
            imperial={imperial}
            onChange={(t) => set({ wallThickness: t })}
            precise
          />
        </label>
      )}
      {tool === 'obstacle' && (
        <label className="flex flex-col gap-1 px-2 text-xs text-stone-600">
          Kind
          <select
            value={obstacleKind}
            onChange={(e) => set({ obstacleKind: ObstacleKind.parse(e.target.value) })}
            className="rounded border border-stone-300 px-1 py-1 text-sm text-stone-800"
          >
            {ObstacleKind.options.map((k) => (
              <option key={k} value={k}>
                {FIXTURES[k]}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="mt-auto flex flex-col gap-1 border-t border-stone-200 pt-2">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className={button(false)}
            title="Ctrl+Z"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className={button(false)}
            title="Ctrl+Shift+Z"
          >
            Redo
          </button>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('editor:fit'))}
          className={button(false)}
        >
          Fit to screen <kbd className="text-xs opacity-60">F</kbd>
        </button>
        <label className="flex items-center gap-2 px-2 py-1 text-xs text-stone-600">
          <input
            type="checkbox"
            checked={imperial}
            onChange={(e) => set({ imperial: e.target.checked })}
          />
          Feet and inches
        </label>
        <p className="px-2 text-xs text-stone-400">Hold Shift to draw without snapping.</p>
      </div>
    </nav>
  );
}
