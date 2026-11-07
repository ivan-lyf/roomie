import { create } from 'zustand';

// How the workspace is shown (§4.6, §8): never undone, never saved. What's selected, placed or
// previewed stays in the furnish store, which the 3D scene follows.

export type View = '3d' | 'top';
export type Sheet = 'swap' | 'add' | undefined;

type WorkspaceState = {
  view: View;
  /** Lower the walls between the camera and the room in view. */
  cutaway: boolean;
  ceilings: boolean;
  /** Feet and inches, or meters; undefined follows the plan's own unit. */
  imperial: boolean | undefined;
  sheet: Sheet;
  /** Counts up to frame the view afresh. */
  resets: number;
  set: (change: Partial<Omit<WorkspaceState, 'set' | 'reset'>>) => void;
  reset: () => void;
};

const START = { view: '3d' as View, cutaway: true, ceilings: false, imperial: undefined, sheet: undefined };

export const useWorkspace = create<WorkspaceState>()((set) => ({
  ...START,
  resets: 0,
  set: (change) => set(change),
  reset: () => set(START),
}));
