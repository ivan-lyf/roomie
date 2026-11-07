import { type Category, type Floorplan, type Room, StylePreset } from '@roomie/schema';
import { Shuffle } from 'lucide-react';
import { useState } from 'react';
import { startRoomAgain } from '../../api';
import { supabase } from '../../auth';
import { mustHavesFor, refusalText } from '../../copy';
import { roomBudget } from '../../furnishing';
import { runFurnishing } from '../../generation';
import { STYLE_CARDS } from '../../preferences';
import { useAccount } from '../../stores/account';
import { useFurnish } from '../../stores/furnish';
import { useIntents } from '../../stores/intents';
import { useProducts } from '../../stores/products';
import { useSignIn } from '../account/signIn';
import { Button, Chip, Notice } from '../kit';

type Props = { plan: Floorplan; room: Room };

/** What new pieces are asked for with, until they're asked for. */
type Asking = { budget: string; style: StylePreset; needs: string[] };

/**
 * Another layout for one room, the others kept as they are (§4.6): the same pieces laid out
 * again, or new pieces chosen for it. Either replaces what the room had, as one step to undo.
 */
export function TryAnother({ plan, room }: Props) {
  const products = useProducts((s) => s.byArticle);
  const planned = useIntents((s) => s.furnishing);
  const busy = useFurnish((s) => s.busy);
  const email = useAccount((s) => s.email);
  const openSignIn = useSignIn((s) => s.open);
  const [asking, setAsking] = useState<Asking>();
  const [invalid, setInvalid] = useState<string>();
  const items = plan.furniture.filter((f) => f.roomId === room.id);
  // The last furnishing started, if it was of this room.
  const furnishing = useFurnish((s) => (s.furnishing?.roomId === room.id ? s.furnishing : undefined));
  const job = furnishing?.job;
  const status = job?.rooms.find((r) => r.roomId === room.id);
  const failed = furnishing?.error
    ? furnishing.code
      ? refusalText(furnishing.code)
      : "We couldn't lay out this room just now. Try again in a moment."
    : job?.status === 'failed'
      ? "We couldn't lay out this room just now. Try again in a moment."
      : undefined;
  const again = (begin: () => Promise<string>) => {
    setInvalid(undefined);
    void runFurnishing(plan.id, [room.id], room.id, begin);
  };

  const rearrange = () => again(() => startRoomAgain(plan.id, room.id, { mode: 'rearrange' }));
  const choose = () => {
    const kinds = new Set(items.flatMap((f) => products.get(f.articleNo)?.category ?? []));
    setAsking({
      budget: String(roomBudget(planned, plan.furniture, products, room.id)),
      style: planned?.style ?? 'scandinavian',
      needs: mustHavesFor(room.roomType)
        .filter((m) => m.categories.every((c) => kinds.has(c)))
        .map((m) => m.label),
    });
  };
  const ask = (a: Asking) => {
    const budgetCad = Number(a.budget.replace(/[^\d.]/g, ''));
    if (!(budgetCad > 0)) return setInvalid('Type a budget in dollars, like 1200.');
    const go = () => {
      setAsking(undefined);
      const mustHaves = mustHavesFor(room.roomType)
        .filter((m) => a.needs.includes(m.label))
        .flatMap((m) => m.categories) as Category[];
      again(() =>
        startRoomAgain(plan.id, room.id, { mode: 'new_pieces', budgetCad, style: a.style, mustHaves }),
      );
    };
    // New pieces are an AI step: signed out, it waits for sign-in (§4.8).
    if (supabase && !email) openSignIn({ reason: 'step', then: go });
    else go();
  };

  return (
    <section className="flex flex-col gap-2">
      <Button disabled={busy || items.length === 0} onClick={rearrange}>
        <Shuffle size={18} aria-hidden /> Try another layout for this room
      </Button>
      {!asking && (
        <Button variant="link" className="self-start text-[15px]" disabled={busy} onClick={choose}>
          Or choose new pieces for it
        </Button>
      )}

      {asking && (
        <fieldset className="m-0 flex flex-col gap-3 border border-line p-3">
          <legend className="px-1 font-semibold">New pieces for the {room.name}</legend>
          <label className="flex items-center gap-2">
            <span className="w-28 text-ink-muted">Budget</span>
            <span className="font-mono">$</span>
            <input
              inputMode="numeric"
              value={asking.budget}
              onChange={(e) => setAsking({ ...asking, budget: e.target.value })}
              className="w-28 rounded-control border border-line-strong px-2 py-1.5 font-mono tabular-nums"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-28 text-ink-muted">Style</span>
            <select
              value={asking.style}
              onChange={(e) => setAsking({ ...asking, style: StylePreset.parse(e.target.value) })}
              className="rounded-control border border-line-strong bg-surface px-2 py-1.5"
            >
              {StylePreset.options.map((s) => (
                <option key={s} value={s}>
                  {STYLE_CARDS[s].title}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {mustHavesFor(room.roomType).map((m) => {
              const on = asking.needs.includes(m.label);
              return (
                <Chip
                  key={m.label}
                  pressed={on}
                  onClick={() =>
                    setAsking({
                      ...asking,
                      needs: on ? asking.needs.filter((n) => n !== m.label) : [...asking.needs, m.label],
                    })
                  }
                >
                  {on ? '✓' : '+'} {m.label}
                </Chip>
              );
            })}
          </div>
          {invalid && (
            <p role="alert" className="m-0 text-danger">
              {invalid}
            </p>
          )}
          <div className="flex items-center gap-4">
            <Button size="sm" onClick={() => ask(asking)}>
              Get new pieces
            </Button>
            <Button variant="link" onClick={() => setAsking(undefined)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      )}

      <div aria-live="polite" className="flex flex-col gap-1 text-sm">
        {job?.status === 'running' && (
          <p className="m-0 text-ink-muted">Working on the {room.name}…</p>
        )}
        {status?.reasons?.map((reason, i) => (
          <p key={i} className="m-0 text-ink-muted">
            {reason}
          </p>
        ))}
        {job?.status === 'done' && (
          <p className="m-0 text-ink-muted">Done. Undo puts back what was there before.</p>
        )}
        {failed && <Notice tone="warn">{failed}</Notice>}
      </div>
    </section>
  );
}
