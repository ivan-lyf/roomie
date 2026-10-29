import type { Floorplan } from '@roomie/schema';
import { useEffect, useRef, useState } from 'react';
import { saveFloorplan } from './api';
import { DEMO_ID } from './plans';
import { useFloorplan } from './stores/floorplan';

/** Saves this long after the last change. */
const DELAY_MS = 1000;
/** Editing time stops counting after this long without input. */
const IDLE_MS = 30_000;

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed' | 'local';

/**
 * Editing time saved so far, per plan. Kept out of the store, so undo can't take it back and the
 * plan held over from the other page can't be behind.
 */
const savedSeconds = new Map<string, number>();

type StoreState = { plan: Floorplan | undefined; loaded: Floorplan | undefined };

/**
 * What a change to the floorplan store means for saving: a plan loaded from the server (already
 * saved), or an edit. An undo back to the loaded plan is an edit too: the server may have moved
 * on since.
 */
export function storeChange(s: StoreState, prev: StoreState): 'loaded' | 'edited' | undefined {
  if (s.plan === prev.plan || !s.plan) return undefined;
  return s.loaded !== prev.loaded && s.plan === s.loaded ? 'loaded' : 'edited';
}

/** Saves one plan's changes from the store, one request at a time. */
class Saver {
  saved: Floorplan | undefined;
  /** Active editing time not saved yet. */
  seconds = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;

  constructor(
    private readonly id: string,
    private readonly onState: (state: SaveState) => void,
  ) {}

  get pending() {
    return useFloorplan.getState().plan !== this.saved;
  }

  schedule() {
    this.onState('unsaved');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), DELAY_MS);
  }

  async save() {
    clearTimeout(this.timer);
    const plan = useFloorplan.getState().plan;
    if (!plan || plan.id !== this.id || plan === this.saved || this.busy) return;
    this.busy = true;
    this.onState('saving');
    const counted = Math.floor(this.seconds);
    const total = (savedSeconds.get(this.id) ?? plan.editSeconds) + counted;
    try {
      await saveFloorplan({ ...plan, editSeconds: total });
      this.seconds -= counted;
      savedSeconds.set(this.id, total);
      this.saved = plan;
      this.busy = false;
      if (this.pending) this.schedule();
      else this.onState('saved');
    } catch {
      this.busy = false;
      this.onState('failed');
    }
  }

  /** Saves now, once any save under way is done; false if something is still not saved. */
  async flush(): Promise<boolean> {
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 50));
    if (this.pending) await this.save();
    return !this.pending;
  }

  dispose() {
    clearTimeout(this.timer);
  }
}

/** The saver of the plan open now. */
let open: Saver | undefined;

/**
 * Saves what isn't saved yet of the plan open now, and says whether it's all saved: before
 * asking the server for something that reads the saved plan, such as furnishing it.
 */
export function saveNow(): Promise<boolean> {
  return open ? open.flush() : Promise.resolve(true);
}

/**
 * Saves the plan a second after each change, and counts the time spent actively editing it
 * (the tab visible, input in the last 30 s) into `editSeconds`. The demo plan stays local.
 */
export function useAutosave(id: string): { state: SaveState; retry: () => void } {
  const [state, setState] = useState<SaveState>('saved');
  const retry = useRef(() => {});

  useEffect(() => {
    if (id === DEMO_ID) return;
    const saver = new Saver(id, setState);
    open = saver;
    retry.current = () => void saver.save();
    saver.saved = useFloorplan.getState().plan;
    const unsubscribe = useFloorplan.subscribe((s, prev) => {
      const what = storeChange(s, prev);
      if (what === 'loaded') saver.saved = s.plan;
      else if (what === 'edited' && s.plan?.id === id && s.plan !== saver.saved) saver.schedule();
    });
    const flush = () => {
      if (document.visibilityState === 'hidden') void saver.save();
    };
    const warn = (e: BeforeUnloadEvent) => {
      if (saver.pending) e.preventDefault();
    };
    let last = Date.now();
    const input = () => (last = Date.now());
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, input, { passive: true }));
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - last < IDLE_MS) saver.seconds++;
    }, 1000);
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('beforeunload', warn);
    return () => {
      unsubscribe();
      clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, input));
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('beforeunload', warn);
      if (open === saver) open = undefined;
      // Leaving the page saves what's left.
      void saver.save().finally(() => saver.dispose());
    };
  }, [id]);

  return { state: id === DEMO_ID ? 'local' : state, retry: () => retry.current() };
}
