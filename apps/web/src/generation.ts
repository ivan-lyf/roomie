import type { GenerationJob } from '@roomie/schema';
import { useEffect } from 'react';
import { fetchGeneration } from './api';
import { saveNow } from './autosave';
import { useAccount } from './stores/account';
import { useFloorplan } from './stores/floorplan';
import { useFurnish } from './stores/furnish';
import { useIntents } from './stores/intents';

// A furnishing on the server, one at a time: started from the Furnish tab and followed from the
// home page, so moving between rooms and tabs while it runs doesn't lose it. The furniture can't
// be edited meanwhile, so the result can't clash with an edit made while it was worked out.

/** How often to ask how a furnishing is going. */
const POLL_MS = 1000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Saves the plan, so the server furnishes what's on screen, then starts a furnishing of these
 * rooms with `begin`, which answers its id: the whole home, or one room again (`roomId`).
 */
export async function runFurnishing(
  floorplanId: string,
  roomIds: string[],
  roomId: string | undefined,
  begin: () => Promise<string>,
) {
  const { setBusy, setFurnishing } = useFurnish.getState();
  setBusy(true);
  setFurnishing({ roomId });
  try {
    if (!(await saveNow())) {
      throw new Error("Your latest changes couldn't be saved, so this has to wait: try again.");
    }
    const generationId = await begin();
    const rooms = roomIds.map((id) => ({ roomId: id, status: 'waiting' as const }));
    setFurnishing({ roomId, job: { generationId, floorplanId, status: 'running', rooms } });
  } catch (e) {
    setBusy(false);
    setFurnishing({ roomId, error: message(e) });
  }
}

/** Puts in what a furnishing came to, if its home is still the one open. */
function apply(job: GenerationJob, roomId: string | undefined) {
  const { plan, setFurniture, setRoomFurniture } = useFloorplan.getState();
  if (plan?.id === job.floorplanId && job.furniture) {
    if (roomId === undefined) setFurniture(job.furniture);
    else
      setRoomFurniture(
        roomId,
        job.furniture.filter((f) => f.roomId === roomId),
      );
  }
  void useIntents.getState().load(job.floorplanId);
}

/** Asks how the furnishing under way is going until it's over, then puts its result in. */
export function useFurnishingProgress() {
  const furnishing = useFurnish((s) => s.furnishing);
  const job = furnishing?.job;
  const roomId = furnishing?.roomId;
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetchGeneration(job.generationId, ctrl.signal)
        .then((next) => {
          const { setBusy, setFurnishing } = useFurnish.getState();
          setFurnishing({ roomId, job: next });
          if (next.status === 'running') return;
          setBusy(false);
          // What it cost, in the account line.
          void useAccount.getState().refresh();
          if (next.status === 'done') apply(next, roomId);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          const { setBusy, setFurnishing } = useFurnish.getState();
          setBusy(false);
          setFurnishing({ roomId, job, error: message(e) });
        });
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [job, roomId]);
}
