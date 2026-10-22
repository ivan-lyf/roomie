import { Floorplan } from '@roomie/schema';
import { useEffect, useState } from 'react';
import demo from '../../../fixtures/plans/00-demo-1br/floorplan.json';
import { fetchFloorplan } from './api';
import { useFloorplan } from './stores/floorplan';

/** The plan that comes with the app, to try things on. It's never saved. */
export const DEMO_ID = 'demo';

/** A plan from the API, or the built-in demo, checked like anything else read from storage. */
export async function readPlan(id: string, signal: AbortSignal): Promise<Floorplan> {
  if (id !== DEMO_ID) return fetchFloorplan(id, signal);
  const parsed = Floorplan.safeParse(demo);
  if (!parsed.success) throw new Error('The demo floor plan is invalid.');
  return parsed.data;
}

/**
 * The plan with this id, in the floorplan store: loaded unless the store already holds it, from
 * the other page, with any edits not yet saved.
 */
export function usePlan(id: string): { plan?: Floorplan; error?: string } {
  const plan = useFloorplan((s) => s.plan);
  const [error, setError] = useState<{ id: string; message: string }>();
  const wanted = id === DEMO_ID ? (demo as { id: string }).id : id;
  const held = plan?.id === wanted;

  useEffect(() => {
    if (held) return;
    const ctrl = new AbortController();
    readPlan(id, ctrl.signal)
      .then((p) => useFloorplan.getState().load(p))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) {
          setError({ id, message: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => ctrl.abort();
  }, [id, held]);

  if (error?.id === id) return { error: error.message };
  return held ? { plan } : {};
}
