import type { Placement } from '@roomie/schema';
import { create } from 'zustand';

// What furnishing is doing, apart from the plan itself: never undone, never saved.

/**
 * Where an item would stand: the one being dragged (`id`), or a product about to be placed. An
 * item can be shown as another product (`articleNo`), to see a swap before making it.
 */
export type Preview = Pick<Placement, 'x' | 'y' | 'rotation' | 'roomId'> & {
  id?: string;
  articleNo?: string;
};

type FurnishState = {
  /** The product picked to place, and its turn: the next click on a room's floor places it. */
  armed: { articleNo: string; rotation: number } | undefined;
  /** The item selected in the room. */
  selected: string | undefined;
  /** Whether the selected item's swap list is open. */
  swapping: boolean;
  preview: Preview | undefined;
  arm: (articleNo: string | undefined) => void;
  turnArmed: (rotation: number) => void;
  select: (itemId: string | undefined) => void;
  setSwapping: (swapping: boolean) => void;
  setPreview: (preview: Preview | undefined) => void;
  reset: () => void;
};

export const useFurnish = create<FurnishState>()((set) => ({
  armed: undefined,
  selected: undefined,
  swapping: false,
  preview: undefined,
  arm: (articleNo) =>
    set(({ armed }) => ({
      armed: articleNo ? { articleNo, rotation: armed?.rotation ?? 0 } : undefined,
      preview: undefined,
      ...(articleNo && { selected: undefined, swapping: false }),
    })),
  turnArmed: (rotation) => set(({ armed }) => (armed ? { armed: { ...armed, rotation } } : {})),
  select: (selected) =>
    set((s) => ({
      selected,
      swapping: s.swapping && selected === s.selected,
      ...(selected && { armed: undefined }),
    })),
  setSwapping: (swapping) => set({ swapping }),
  setPreview: (preview) => set({ preview }),
  reset: () => set({ armed: undefined, selected: undefined, swapping: false, preview: undefined }),
}));
