import type { GenerationJob, Placement } from '@roomie/schema';
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

/** The last furnishing started: of the whole home, or one room again (`roomId`). */
export type Furnishing = { roomId?: string | undefined; job?: GenerationJob; error?: string };

type FurnishState = {
  /** The product picked to place, and its turn: the next click on a room's floor places it. */
  armed: { articleNo: string; rotation: number } | undefined;
  /** The item selected in the room. */
  selected: string | undefined;
  /** Whether the selected item's swap list is open. */
  swapping: boolean;
  /** A furnishing is under way: the furniture can't be edited until it's done. */
  busy: boolean;
  furnishing: Furnishing | undefined;
  preview: Preview | undefined;
  arm: (articleNo: string | undefined) => void;
  turnArmed: (rotation: number) => void;
  select: (itemId: string | undefined) => void;
  setSwapping: (swapping: boolean) => void;
  setBusy: (busy: boolean) => void;
  setFurnishing: (furnishing: Furnishing | undefined) => void;
  setPreview: (preview: Preview | undefined) => void;
  reset: () => void;
};

export const useFurnish = create<FurnishState>()((set) => ({
  armed: undefined,
  selected: undefined,
  swapping: false,
  busy: false,
  furnishing: undefined,
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
  // A furnishing under way puts down whatever was being placed or swapped.
  setBusy: (busy) =>
    set(busy ? { busy, armed: undefined, swapping: false, preview: undefined } : { busy }),
  setFurnishing: (furnishing) => set({ furnishing }),
  setPreview: (preview) => set({ preview }),
  reset: () =>
    set({
      armed: undefined,
      selected: undefined,
      swapping: false,
      busy: false,
      furnishing: undefined,
      preview: undefined,
    }),
}));
