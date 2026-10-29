import {
  type Category,
  FURNISHABLE,
  type Floorplan,
  type GenerationJob,
  ROOM_CATEGORIES,
  StylePreset,
} from '@roomie/schema';
import { useEffect, useState } from 'react';
import { fetchGeneration, startFurnishing } from '../api';
import { CATEGORIES } from '../format';
import { useFloorplan } from '../stores/floorplan';

/** A starting budget per room furnished, before the user changes it. */
const BUDGET_PER_ROOM = 1200;
/** How often to ask how the furnishing is going. */
const POLL_MS = 1000;

const STYLES: Record<StylePreset, string> = {
  scandinavian: 'Light & natural',
  modern: 'Clean & modern',
  warm_minimal: 'Warm & simple',
};

const STATUS: Record<GenerationJob['rooms'][number]['status'], string> = {
  waiting: 'waiting',
  done: 'done',
  failed: "couldn't be furnished",
};

type Props = {
  plan: Floorplan;
  /** False for the demo, which isn't saved, so can't be furnished on the server. */
  saved: boolean;
};

/**
 * Furnishes the home automatically: which rooms, one budget, a style and what each room must
 * have, then progress per room. The result replaces the furniture as one edit to undo.
 */
export function AutoFurnish({ plan, saved }: Props) {
  const rooms = plan.rooms.filter((r) => r.furnishable && FURNISHABLE.has(r.roomType));
  const [chosen, setChosen] = useState<string[]>(() => rooms.map((r) => r.id));
  const [budget, setBudget] = useState(String(BUDGET_PER_ROOM * Math.max(rooms.length, 1)));
  const [style, setStyle] = useState<StylePreset>('scandinavian');
  const [musts, setMusts] = useState<Record<string, Category[]>>({});
  const [job, setJob] = useState<GenerationJob>();
  const [error, setError] = useState<string>();
  const running = job?.status === 'running';

  // Ask how it's going until it's done, then put the furniture in.
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetchGeneration(job.generationId, ctrl.signal)
        .then((next) => {
          setJob(next);
          if (next.status === 'done' && next.furniture) {
            useFloorplan.getState().setFurniture(next.furniture);
          }
        })
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
        });
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [job]);

  if (rooms.length === 0) return null;
  if (!saved) {
    return (
      <p className="text-stone-500">Upload a plan of your own to have it furnished for you.</p>
    );
  }

  const start = () => {
    setError(undefined);
    const budgetCad = Number(budget);
    if (!(budgetCad > 0)) return setError('Enter a budget in dollars.');
    if (chosen.length === 0) return setError('Pick at least one room to furnish.');
    const inputs = {
      roomIds: chosen,
      budgetCad,
      style,
      mustHaves: Object.fromEntries(chosen.map((id) => [id, musts[id] ?? []])),
    };
    startFurnishing(plan.id, inputs)
      .then((generationId) =>
        setJob({
          generationId,
          floorplanId: plan.id,
          status: 'running',
          rooms: chosen.map((roomId) => ({ roomId, status: 'waiting' })),
        }),
      )
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const name = (id: string) => plan.rooms.find((r) => r.id === id)?.name ?? id;
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <section className="space-y-2 rounded-md border border-stone-200 p-2">
      <h2 className="font-medium">Furnish for me</h2>
      <fieldset className="space-y-1" disabled={running}>
        {rooms.map((room) => (
          <div key={room.id}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={chosen.includes(room.id)}
                onChange={() => setChosen(toggle(chosen, room.id))}
              />
              {room.name}
            </label>
            {chosen.includes(room.id) && (
              <div className="ml-6 flex flex-wrap gap-1">
                {(ROOM_CATEGORIES[room.roomType] ?? []).map((c) => {
                  const on = (musts[room.id] ?? []).includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setMusts({ ...musts, [room.id]: toggle(musts[room.id] ?? [], c) })
                      }
                      className={`rounded-full px-2 py-0.5 text-xs ${on ? 'bg-stone-800 text-white' : 'bg-stone-100'}`}
                    >
                      {CATEGORIES[c]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        <p className="text-xs text-stone-500">The darker chips are what a room must have.</p>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-0.5">
            <span className="text-xs text-stone-500">Budget for everything, $</span>
            <input
              className="rounded-md border border-stone-300 p-1"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-0.5">
            <span className="text-xs text-stone-500">Style</span>
            <select
              className="rounded-md border border-stone-300 bg-white p-1"
              value={style}
              onChange={(e) => setStyle(StylePreset.parse(e.target.value))}
            >
              {StylePreset.options.map((s) => (
                <option key={s} value={s}>
                  {STYLES[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          onClick={start}
          className="w-full rounded-md bg-stone-800 px-3 py-1.5 text-white disabled:opacity-50"
        >
          {running ? 'Furnishing…' : 'Furnish my home'}
        </button>
      </fieldset>

      {error && <p className="text-red-700">{error}</p>}
      {job && (
        <ul className="space-y-0.5">
          {job.rooms.map((r) => (
            <li key={r.roomId}>
              {name(r.roomId)}: {STATUS[r.status]}
              {r.reasons?.map((reason, i) => (
                <span key={i} className="block text-xs text-stone-500">
                  {reason}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {job?.status === 'running' && (
        <p className="text-xs text-stone-500">This usually takes under a minute.</p>
      )}
      {job?.status === 'done' && (
        <p className="text-xs text-stone-500">
          Done{job.costUsd !== undefined && ` ($${job.costUsd.toFixed(2)} US of AI time)`}. Ctrl+Z
          puts back what was there before.
        </p>
      )}
      {job?.status === 'failed' && <p className="text-red-700">{job.error}</p>}
    </section>
  );
}
