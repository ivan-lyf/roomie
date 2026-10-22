import type { Floorplan } from '@roomie/schema';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, readFloorplan } from './api';
import { DEMO_ID } from './plans';
import { useEditor } from './stores/editor';
import { useFloorplan } from './stores/floorplan';

export type ReadState =
  | { state: 'idle' }
  | { state: 'reading'; replace: boolean }
  | { state: 'failed'; message: string; replace: boolean; noReader: boolean };

/** Plans this page has started reading, so one that fails isn't read again and again. */
const started = new Set<string>();

/**
 * Has the plan reader read the plan: once by itself for a new upload, and again on request
 * (replacing what's traced, as one edit to undo).
 */
export function usePlanReader(id: string, plan: Floorplan | undefined) {
  const [read, setRead] = useState<ReadState>({ state: 'idle' });

  const run = useCallback(
    async (replace: boolean) => {
      setRead({ state: 'reading', replace });
      try {
        const result = await readFloorplan(id, replace);
        const store = useFloorplan.getState();
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
          noReader: e instanceof ApiError && e.status === 503,
        });
      }
    },
    [id],
  );

  const fresh =
    plan !== undefined &&
    plan.image !== null &&
    plan.reading === null &&
    plan.walls.length === 0 &&
    plan.rooms.length === 0;
  useEffect(() => {
    if (id === DEMO_ID || !fresh || started.has(id)) return;
    started.add(id);
    // The first state change waits a tick: an effect shouldn't set state as it runs.
    const t = setTimeout(() => void run(false));
    return () => clearTimeout(t);
  }, [id, fresh, run]);

  return { read, run, dismiss: () => setRead({ state: 'idle' }) };
}
