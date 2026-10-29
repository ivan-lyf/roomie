import { isTraced } from '@roomie/geometry';
import type { Floorplan } from '@roomie/schema';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, readFloorplan } from './api';
import { supabase } from './auth';
import { DEMO_ID } from './plans';
import { useAccount } from './stores/account';
import { useEditor } from './stores/editor';
import { useFloorplan } from './stores/floorplan';

export type ReadState =
  | { state: 'idle' }
  /** Waiting for the user to sign in, which reading needs (PLAN.md M6). */
  | { state: 'signIn'; replace: boolean }
  | { state: 'reading'; replace: boolean }
  | { state: 'failed'; message: string; replace: boolean; noReader: boolean };

/** Plans this page has started reading, so one that fails isn't read again and again. */
const started = new Set<string>();

/**
 * Has the plan reader read the plan: once by itself for a new upload, and again on request
 * (replacing what's traced, as one edit to undo). Signed out, it waits for sign-in, then reads.
 */
export function usePlanReader(id: string, plan: Floorplan | undefined) {
  const [read, setRead] = useState<ReadState>({ state: 'idle' });
  const email = useAccount((s) => s.email);
  // Whether the user has to sign in first: not where sign-in isn't set up (the API says then).
  const signedOut = supabase !== undefined && email === null;

  const run = useCallback(
    async (replace: boolean) => {
      if (signedOut) return setRead({ state: 'signIn', replace });
      setRead({ state: 'reading', replace });
      try {
        const result = await readFloorplan(id, replace);
        const store = useFloorplan.getState();
        // A reading takes minutes: if another plan is open by now, this one is saved and done.
        if (store.plan?.id !== result.id) return;
        if (replace) store.replace(result);
        else store.load(result);
        const editor = useEditor.getState();
        editor.select([]);
        editor.setTool(result.scale ? 'select' : 'measure');
        setRead({ state: 'idle' });
      } catch (e) {
        setRead({
          state: 'failed',
          message: e instanceof Error ? e.message : String(e),
          replace,
          noReader: e instanceof ApiError && e.status === 503 && e.code === undefined,
        });
      } finally {
        // What the reading cost, in the account line.
        void useAccount.getState().refresh();
      }
    },
    [id, signedOut],
  );

  // Once signed in, a reading that waited for it goes ahead.
  const waiting = read.state === 'signIn' ? read : undefined;
  useEffect(() => {
    if (!waiting || !email) return;
    // A tick later, so state isn't set while the effect runs.
    const t = setTimeout(() => void run(waiting.replace));
    return () => clearTimeout(t);
  }, [waiting, email, run]);

  const fresh =
    plan !== undefined && plan.image !== null && plan.reading === null && !isTraced(plan);
  useEffect(() => {
    // Not before it's known whether anyone is signed in.
    if (id === DEMO_ID || !fresh || started.has(id) || email === undefined) return;
    // A tick later, so state isn't set while the effect runs, and only then marked started: a
    // development double run (StrictMode) clears the first timer before it fires.
    const t = setTimeout(() => {
      started.add(id);
      void run(false);
    });
    return () => clearTimeout(t);
  }, [id, fresh, run, email]);

  return { read, run, dismiss: () => setRead({ state: 'idle' }) };
}
