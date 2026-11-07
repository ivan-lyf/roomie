import { create } from 'zustand';

// Asking to sign in, from anywhere (§4.8): an AI step opens the dialog, and goes ahead by itself
// once the account is there. A Google sign-in leaves the page and comes back to it, so the step to
// resume is also kept for the tab in sessionStorage, by name, for its page to pick up.

type Ask = {
  /** Why we ask: an AI step, or the user choosing to sign in. */
  reason: 'step' | 'choice';
  /** What to do once signed in, on this page. */
  then?: () => void;
};

type SignInState = {
  ask: Ask | undefined;
  open: (ask: Ask) => void;
  close: () => void;
};

export const useSignIn = create<SignInState>()((set) => ({
  ask: undefined,
  open: (ask) => set({ ask }),
  close: () => set({ ask: undefined }),
}));

const KEY = 'roomie.resume';

/** Remembers, for this tab, a step to start once the user comes back signed in. */
export function resumeAfterSignIn(step: string) {
  try {
    sessionStorage.setItem(KEY, step);
  } catch {
    // Without storage the user clicks the step again after signing in.
  }
}

/** The step to resume, once: it's forgotten as it's read. */
export function takeResume(): string | undefined {
  try {
    const step = sessionStorage.getItem(KEY) ?? undefined;
    sessionStorage.removeItem(KEY);
    return step;
  } catch {
    return undefined;
  }
}

/** Forgets a step to resume, when the user closes the dialog instead. */
export function forgetResume() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}
