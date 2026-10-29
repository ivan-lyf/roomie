import {
  type Category,
  type Floorplan,
  ROOM_CATEGORIES,
  type Room,
  StylePreset,
} from '@roomie/schema';
import { useState } from 'react';
import { startRoomAgain } from '../api';
import { supabase } from '../auth';
import { CATEGORIES, STYLES } from '../format';
import { roomBudget } from '../furnishing';
import { runFurnishing } from '../generation';
import { useAccount } from '../stores/account';
import { useFurnish } from '../stores/furnish';
import { useIntents } from '../stores/intents';
import { useProducts } from '../stores/products';
import { SignIn } from './SignIn';

type Props = { plan: Floorplan; room: Room };

/** What the new pieces are asked for with, until they're asked for. */
type Asking = { budget: string; style: StylePreset; musts: Category[] };

/**
 * Another layout for one room, the rest of the home kept as it is: the same pieces laid out
 * again, for free, or new pieces the AI chooses for it. The result replaces what the room had,
 * as one edit to undo.
 */
export function TryAnother({ plan, room }: Props) {
  const products = useProducts((s) => s.byArticle);
  const planned = useIntents((s) => s.furnishing);
  const busy = useFurnish((s) => s.busy);
  const [asking, setAsking] = useState<Asking>();
  // New pieces need sign-in (PLAN.md M6); a rearrange doesn't.
  const signedOut = useAccount((s) => supabase !== undefined && s.email === null);
  const [signingIn, setSigningIn] = useState(false);
  const items = plan.furniture.filter((f) => f.roomId === room.id);
  // The last furnishing started, if it was of this room.
  const furnishing = useFurnish((s) =>
    s.furnishing?.roomId === room.id ? s.furnishing : undefined,
  );
  const [invalid, setInvalid] = useState<string>();
  const job = furnishing?.job;
  const error = invalid ?? furnishing?.error;
  const status = job?.rooms.find((r) => r.roomId === room.id);
  const again = (begin: () => Promise<string>) => {
    setInvalid(undefined);
    void runFurnishing(plan.id, [room.id], room.id, begin);
  };

  const rearrange = () => again(() => startRoomAgain(plan.id, room.id, { mode: 'rearrange' }));
  const choose = () => {
    if (signedOut) return setSigningIn(true);
    const kinds = new Set(items.flatMap((f) => products.get(f.articleNo)?.category ?? []));
    setAsking({
      budget: String(roomBudget(planned, plan.furniture, products, room.id)),
      style: planned?.style ?? 'scandinavian',
      musts: (ROOM_CATEGORIES[room.roomType] ?? []).filter((c) => kinds.has(c)),
    });
  };
  const ask = (a: Asking) => {
    const budgetCad = Number(a.budget);
    if (!(budgetCad > 0)) return setInvalid('Enter a budget in dollars.');
    setAsking(undefined);
    again(() =>
      startRoomAgain(plan.id, room.id, {
        mode: 'new_pieces',
        budgetCad,
        style: a.style,
        mustHaves: a.musts,
      }),
    );
  };

  const button = 'rounded-md border border-stone-300 bg-white px-2 py-1 disabled:opacity-50';
  return (
    <section className="space-y-2 rounded-md border border-stone-200 p-2">
      <h2 className="font-medium">Try another layout</h2>
      <p className="text-xs text-stone-500">The other rooms stay as they are.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={busy || items.length === 0}
          onClick={rearrange}
        >
          Rearrange what&apos;s here (free)
        </button>
        <button type="button" className={button} disabled={busy} onClick={choose}>
          New pieces (uses AI, a few cents)
        </button>
      </div>

      {signingIn && signedOut && <SignIn what="choose new pieces for this room" />}
      {asking && (
        <fieldset className="space-y-2 rounded-md bg-stone-50 p-2">
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-0.5">
              <span className="text-xs text-stone-500">Budget for this room, $</span>
              <input
                className="rounded-md border border-stone-300 p-1"
                inputMode="numeric"
                value={asking.budget}
                onChange={(e) => setAsking({ ...asking, budget: e.target.value })}
              />
            </label>
            <label className="flex flex-1 flex-col gap-0.5">
              <span className="text-xs text-stone-500">Style</span>
              <select
                className="rounded-md border border-stone-300 bg-white p-1"
                value={asking.style}
                onChange={(e) => setAsking({ ...asking, style: StylePreset.parse(e.target.value) })}
              >
                {StylePreset.options.map((s) => (
                  <option key={s} value={s}>
                    {STYLES[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            {(ROOM_CATEGORIES[room.roomType] ?? []).map((c) => {
              const on = asking.musts.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setAsking({
                      ...asking,
                      musts: on ? asking.musts.filter((m) => m !== c) : [...asking.musts, c],
                    })
                  }
                  className={`rounded-full px-2 py-0.5 text-xs ${on ? 'bg-stone-800 text-white' : 'bg-stone-100'}`}
                >
                  {CATEGORIES[c]}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-stone-500">The darker chips are what the room must have.</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-md bg-stone-800 px-3 py-1.5 text-white"
              onClick={() => ask(asking)}
            >
              Get new pieces
            </button>
            <button type="button" className={button} onClick={() => setAsking(undefined)}>
              Cancel
            </button>
          </div>
        </fieldset>
      )}

      {error && <p className="text-red-700">{error}</p>}
      {job?.status === 'running' && (
        <p className="text-xs text-stone-500">
          Working on the {room.name}… The furniture can&apos;t be changed until it&apos;s done.
        </p>
      )}
      {status?.reasons?.map((reason, i) => (
        <p key={i} className="text-xs text-stone-500">
          {reason}
        </p>
      ))}
      {job?.status === 'done' && (
        <p className="text-xs text-stone-500">
          Done{job.costUsd ? ` ($${job.costUsd.toFixed(2)} US of AI time)` : ''}. Ctrl+Z puts back
          what was there before.
        </p>
      )}
      {job?.status === 'failed' && <p className="text-red-700">{job.error}</p>}
    </section>
  );
}
