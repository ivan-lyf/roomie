import type { ObstacleKind, Vec2 } from '@roomie/schema';
import { create } from 'zustand';

// What the editor is doing, apart from the plan itself: never undone, never saved.

export type Tool =
  | 'select'
  | 'wall'
  | 'door'
  | 'window'
  | 'passage'
  | 'room'
  | 'split'
  | 'obstacle'
  | 'measure';

/** How the scale is being set (PLAN.md §5.1). */
export type CalibrationMethod = 'wall_length' | 'area' | 'area_and_side';

/** What the measuring tool has drawn on the image, in image pixels. */
export type Measure = {
  /** A line along something of known length. */
  line?: [Vec2, Vec2];
  /** An outline of known area. */
  outline?: Vec2[];
};

type EditorState = {
  tool: Tool;
  selection: string[];
  /** Points drawn so far with the wall, room, split or measuring tools. */
  draft: Vec2[];
  /** Whether lengths show in feet and inches. */
  imperial: boolean;
  wallThickness: number;
  obstacleKind: ObstacleKind;
  method: CalibrationMethod;
  measure: Measure;
  setTool: (tool: Tool) => void;
  select: (ids: string[]) => void;
  /** Adds an element to the selection, or takes it out. */
  toggle: (id: string) => void;
  setDraft: (draft: Vec2[]) => void;
  set: (
    change: Partial<
      Pick<EditorState, 'imperial' | 'wallThickness' | 'obstacleKind' | 'method' | 'measure'>
    >,
  ) => void;
};

export const useEditor = create<EditorState>()((set) => ({
  tool: 'select',
  selection: [],
  draft: [],
  imperial: true,
  wallThickness: 0.15,
  obstacleKind: 'counter',
  method: 'wall_length',
  measure: {},
  setTool: (tool) => set({ tool, draft: [] }),
  select: (selection) => set({ selection }),
  toggle: (id) =>
    set(({ selection }) => ({
      selection: selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id],
    })),
  setDraft: (draft) => set({ draft }),
  set: (change) => set(change),
}));
