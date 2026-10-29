import type { HomeFurnishing } from '@roomie/schema';
import { create } from 'zustand';
import { fetchFurnishing } from '../api';

// What the home's furnishings planned (PLAN.md M5): each room's intent, for why each item is
// there and how it relates to the others, and the budget. From the API: never undone, never saved.

type IntentsState = {
  /** The plan it's for. */
  planId: string | undefined;
  /** Nothing for the demo, a home furnished by hand, or while it loads. */
  furnishing: HomeFurnishing | undefined;
  /** Fetches a saved home's, again after each furnishing; the demo has none. */
  load: (planId: string | undefined) => Promise<void>;
};

export const useIntents = create<IntentsState>()((set, get) => ({
  planId: undefined,
  furnishing: undefined,
  load: async (planId) => {
    if (get().planId !== planId) set({ planId, furnishing: undefined });
    if (!planId) return;
    try {
      const furnishing = await fetchFurnishing(planId);
      if (get().planId === planId) set({ furnishing });
    } catch {
      // Offline or the API down: no reasons to show, which is what a hand-furnished home has.
    }
  },
}));
