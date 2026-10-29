import type { Me } from '@roomie/schema';
import { create } from 'zustand';
import { fetchMe } from '../api';
import { supabase } from '../auth';

// Who's signed in, and what they've spent on AI today: never undone, never saved.

type AccountState = {
  /** Undefined while it's being found out; null when signed out or sign-in isn't set up. */
  email: string | null | undefined;
  /** Today's AI spending, once the API has said. */
  me: Me | undefined;
  /** Asks the API again how much was spent today, after an AI step. */
  refresh: () => Promise<void>;
};

export const useAccount = create<AccountState>()((set, get) => ({
  email: supabase ? undefined : null,
  me: undefined,
  refresh: async () => {
    if (!get().email) return set({ me: undefined });
    try {
      set({ me: await fetchMe() });
    } catch {
      // The API is down or doesn't know the session: no spending to show.
      set({ me: undefined });
    }
  },
}));

// Follow the session as Supabase signs in, refreshes and signs out, a sign-in link coming back
// to the page included.
supabase?.auth.onAuthStateChange((_, session) => {
  const email = session ? (session.user.email ?? '') : null;
  if (email === useAccount.getState().email) return;
  useAccount.setState({ email, me: undefined });
  // After the callback: Supabase holds its lock while it runs.
  setTimeout(() => void useAccount.getState().refresh());
});
