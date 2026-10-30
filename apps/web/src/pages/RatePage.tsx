import {
  type ItemNote,
  type Product,
  type RatingPair,
  type RatingSaved,
  type RatingSummary,
  type RatingWinner,
  RoomProblem,
  type Side,
} from '@roomie/schema';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ApiError, archiveRating, fetchNextPair, fetchRatingSummary, saveRating } from '../api';
import { ROOM_TYPES } from '../format';
import {
  describeProduct,
  differences,
  FEATURES,
  ROOM_PROBLEMS,
  tally,
  toggleItem,
} from '../rating';
import { CameraLink, type Preset } from '../scene/home/cameraLink';
import { ShownFurniture } from '../scene/home/Furniture';
import { HomeView } from '../scene/home/HomeView';
import { useAccount } from '../stores/account';
import { useProducts, useProductsFor } from '../stores/products';
import { SignIn } from '../ui/SignIn';

// The internal rating page (PLAN.md M7): one room from two layouts side by side in 3D. Pick the
// better one, say whether you'd live with it, and say why in your own words. Plain screens: the
// user-facing design leaves internal pages out.

type Loaded =
  | { kind: 'loading' }
  | { kind: 'refused'; error: ApiError | Error }
  | { kind: 'done' }
  | { kind: 'pair'; pair: RatingPair; shownAt: number };

type Form = {
  winner: RatingWinner | undefined;
  livable: boolean | undefined;
  note: string;
  itemNotes: ItemNote[];
  tags: RoomProblem[];
};

const BLANK: Form = { winner: undefined, livable: undefined, note: '', itemNotes: [], tags: [] };

const PICKS: { winner: RatingWinner; label: string; key: string }[] = [
  { winner: 'a', label: 'A is better', key: 'A' },
  { winner: 'same', label: 'About the same', key: 'S' },
  { winner: 'b', label: 'B is better', key: 'B' },
];

const VIEWS: { preset: Preset; label: string; key: string }[] = [
  { preset: 1, label: 'Corner 1', key: '1' },
  { preset: 2, label: 'Corner 2', key: '2' },
  { preset: 3, label: 'Corner 3', key: '3' },
  { preset: 4, label: 'Corner 4', key: '4' },
  { preset: 'top', label: 'From above', key: 'T' },
];

/** A pick, in words: "picked A", "called them about the same". */
const PICKED: Record<RatingWinner, string> = {
  a: 'picked A',
  b: 'picked B',
  same: 'called them about the same',
};

/** A button's look: dark when it's pressed (or the main one), else plain. */
const button = (on = false) =>
  `rounded-md border px-3 py-1.5 disabled:opacity-40 ${
    on
      ? 'border-stone-800 bg-stone-800 text-white hover:bg-stone-700'
      : 'border-stone-300 bg-white hover:bg-stone-50'
  }`;

/** Whether a key went to a text box, not to the page. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

export function RatePage() {
  const email = useAccount((s) => s.email);
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [summary, setSummary] = useState<RatingSummary>();
  const [form, setForm] = useState<Form>(BLANK);
  const [saved, setSaved] = useState<RatingSaved>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [hovered, setHovered] = useState<{ side: Side; id: string }>();
  const link = useMemo(() => new CameraLink(), []);
  const noteBox = useRef<HTMLTextAreaElement>(null);

  const pair = loaded.kind === 'pair' ? loaded.pair : undefined;
  const loading = useProductsFor(
    pair ? [...pair.a.placements, ...pair.b.placements].map((p) => p.articleNo) : [],
  );
  const products = useProducts((s) => s.byArticle);

  const refreshSummary = useCallback(() => {
    fetchRatingSummary().then(setSummary, () => setSummary(undefined));
  }, []);

  const next = useCallback(async () => {
    setLoaded({ kind: 'loading' });
    setForm(BLANK);
    setSaved(undefined);
    setError(undefined);
    try {
      const pair = await fetchNextPair();
      setLoaded(pair ? { kind: 'pair', pair, shownAt: Date.now() } : { kind: 'done' });
      refreshSummary();
    } catch (e) {
      setLoaded({ kind: 'refused', error: e instanceof Error ? e : new Error(String(e)) });
    }
  }, [refreshSummary]);

  // Again once signed in: a sign-in link comes back to this page.
  useEffect(() => {
    if (email === undefined) return;
    // After this render: loading sets state.
    const t = setTimeout(() => void next(), 0);
    return () => clearTimeout(t);
  }, [email, next]);

  const save = useCallback(async () => {
    if (!pair || saved || saving || !form.winner || form.livable === undefined) return;
    setSaving(true);
    setError(undefined);
    try {
      const shownAt = loaded.kind === 'pair' ? loaded.shownAt : Date.now();
      const result = await saveRating({
        layoutA: pair.a.layoutId,
        layoutB: pair.b.layoutId,
        roomId: pair.roomId,
        winner: form.winner,
        livable: form.livable,
        note: form.note.trim() || null,
        itemNotes: form.itemNotes,
        tags: form.tags,
        source: 'pair',
        seconds: Math.round((Date.now() - shownAt) / 100) / 10,
      });
      setSaved(result);
      noteBox.current?.blur();
      refreshSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [pair, saved, saving, form, loaded, refreshSummary]);

  /** Takes the last rating back, to rate the same pair again: it's kept, marked archived. */
  const takeBack = useCallback(async () => {
    if (!saved) return;
    try {
      await archiveRating(saved.rating.id);
      setSaved(undefined);
      refreshSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [saved, refreshSummary]);

  const pick = (winner: RatingWinner) => setForm((f) => ({ ...f, winner }));
  const live = (livable: boolean) => {
    setForm((f) => ({ ...f, livable }));
    // Then the note: say why, if there's something to say.
    setTimeout(() => noteBox.current?.focus(), 0);
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      const view = VIEWS.find((v) => v.key.toLowerCase() === key);
      if (view) return link.goTo(view.preset);
      if (saved) {
        if (key === 'n') void next();
        else if (key === 'backspace') void takeBack();
        else return;
      } else if (key === 'a' || key === 'b') pick(key);
      else if (key === 's') pick('same');
      else if (key === 'y' && form.winner) live(true);
      else if (key === 'n' && form.winner) live(false);
      else if (key === 'enter') void save();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [link, saved, form.winner, next, takeBack, save]);

  /** Enter in a text box saves; Shift+Enter starts a new line in the note. */
  const onTextKey = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  };

  const header = (
    <header className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <Link href="/" className="text-xs text-stone-500">
          ← Plans
        </Link>
        <h1 className="text-xl font-semibold">Rate layouts</h1>
      </div>
      {summary && <p className="text-xs text-stone-500">{tally(summary)}</p>}
    </header>
  );

  if (loaded.kind !== 'pair') {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8 text-sm text-stone-800">
        {header}
        {loaded.kind === 'loading' && <p className="text-stone-500">Finding a pair…</p>}
        {loaded.kind === 'done' && (
          <p>
            Every pair in the pool has been rated. Add more layouts with{' '}
            <code>pnpm ratings:pool</code>.
          </p>
        )}
        {loaded.kind === 'refused' && <Refused error={loaded.error} />}
      </main>
    );
  }

  const { plan, roomId } = loaded.pair;
  const room = plan.rooms.find((r) => r.id === roomId);
  const sides = { a: loaded.pair.a, b: loaded.pair.b };
  const flagged = (side: Side) =>
    new Set(form.itemNotes.filter((n) => n.side === side).map((n) => n.placementId));
  const productOf = (side: Side, id: string): Product | undefined => {
    const placement = sides[side].placements.find((p) => p.id === id);
    return placement && products.get(placement.articleNo);
  };
  const hoveredProduct = hovered && productOf(hovered.side, hovered.id);

  return (
    <main className="flex h-full flex-col gap-3 p-4 text-sm text-stone-800">
      {header}
      <p className="text-stone-600">
        {room?.name ?? roomId} ({room ? ROOM_TYPES[room.roomType] : 'room'}) in {plan.name}. Turn
        either view and the other follows. Click an item to flag it as in a bad spot.
      </p>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3" style={{ minHeight: '45vh' }}>
        {(['a', 'b'] as const).map((side) => (
          <section key={side} className="flex min-h-0 flex-col gap-1">
            <h2 className="font-semibold">{side.toUpperCase()}</h2>
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-stone-200">
              <HomeView
                plan={plan}
                roomId={roomId}
                cutaway
                ceilings={false}
                link={{ camera: link, id: side }}
              >
                <ShownFurniture
                  placements={sides[side].placements}
                  products={products}
                  marked={flagged(side)}
                  onHover={(id) => setHovered(id ? { side, id } : undefined)}
                  onPick={(id) =>
                    setForm((f) => ({ ...f, itemNotes: toggleItem(f.itemNotes, side, id) }))
                  }
                />
              </HomeView>
            </div>
          </section>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={button()}
            onClick={() => link.goTo(v.preset)}
          >
            {v.label} <kbd className="text-stone-400">{v.key}</kbd>
          </button>
        ))}
        <span className="text-xs text-stone-500">
          {loading
            ? 'Loading the products…'
            : hoveredProduct
              ? `${hovered!.side.toUpperCase()} · ${describeProduct(hoveredProduct)}`
              : 'Point at an item to see what it is.'}
        </span>
      </div>

      {saved ? (
        <Reveal saved={saved} onNext={() => void next()} onTakeBack={() => void takeBack()} />
      ) : (
        <form
          className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <span className="pt-1.5 text-stone-500">Which is better?</span>
          <div className="flex flex-wrap gap-2">
            {PICKS.map((p) => (
              <button
                key={p.winner}
                type="button"
                className={button(form.winner === p.winner)}
                aria-pressed={form.winner === p.winner}
                onClick={() => pick(p.winner)}
              >
                {p.label} <kbd className="opacity-60">{p.key}</kbd>
              </button>
            ))}
          </div>

          <span className="pt-1.5 text-stone-500">
            {form.winner === 'same' ? 'Would you live with them?' : 'Would you live with it?'}
          </span>
          <div className="flex gap-2">
            {[true, false].map((yes) => (
              <button
                key={String(yes)}
                type="button"
                disabled={!form.winner}
                className={button(form.livable === yes)}
                aria-pressed={form.livable === yes}
                onClick={() => live(yes)}
              >
                {yes ? 'Yes' : 'No'} <kbd className="opacity-60">{yes ? 'Y' : 'N'}</kbd>
              </button>
            ))}
          </div>

          <span className="pt-1.5 text-stone-500">Why, in your words</span>
          <textarea
            ref={noteBox}
            rows={2}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            onKeyDown={onTextKey}
            placeholder="The armchair is too far from the sofa; the TV in A faces the window…"
            className="w-full rounded-md border border-stone-300 px-2 py-1"
          />

          <span className="pt-1.5 text-stone-500">Room problems</span>
          <div className="flex flex-wrap gap-2">
            {RoomProblem.options.map((tag) => {
              const on = form.tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={button(on)}
                  aria-pressed={on}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      tags: on ? f.tags.filter((t) => t !== tag) : [...f.tags, tag],
                    }))
                  }
                >
                  {ROOM_PROBLEMS[tag]}
                </button>
              );
            })}
          </div>

          {form.itemNotes.length > 0 && (
            <>
              <span className="pt-1.5 text-stone-500">In a bad spot</span>
              <ul className="flex flex-col gap-1">
                {form.itemNotes.map((n) => (
                  <ItemLine
                    key={`${n.side}:${n.placementId}`}
                    note={n}
                    product={productOf(n.side, n.placementId)}
                    onKeyDown={onTextKey}
                    onChange={(note) =>
                      setForm((f) => ({
                        ...f,
                        itemNotes: f.itemNotes.map((m) => (m === n ? { ...m, note } : m)),
                      }))
                    }
                    onRemove={() =>
                      setForm((f) => ({
                        ...f,
                        itemNotes: toggleItem(f.itemNotes, n.side, n.placementId),
                      }))
                    }
                  />
                ))}
              </ul>
            </>
          )}

          <span />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className={button(true)}
              disabled={!form.winner || form.livable === undefined || saving}
            >
              {saving ? 'Saving…' : 'Save'} <kbd className="opacity-60">Enter</kbd>
            </button>
            <button
              type="button"
              className="text-xs text-stone-500 underline"
              onClick={() => void next()}
            >
              Skip this pair
            </button>
            {error && <span className="text-red-700">{error}</span>}
          </div>
        </form>
      )}
    </main>
  );
}

/** A flagged item: which it is, and what's wrong with where it stands. */
function ItemLine(props: {
  note: ItemNote;
  product: Product | undefined;
  onChange: (note: string) => void;
  onRemove: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { note, product } = props;
  return (
    <li className="flex items-center gap-2">
      <span className="w-72 truncate">
        {note.side.toUpperCase()} · {product?.name ?? note.placementId}
      </span>
      <input
        autoFocus
        value={note.note}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={props.onKeyDown}
        placeholder="What's wrong with where it is"
        className="flex-1 rounded-md border border-stone-300 px-2 py-1"
      />
      <button type="button" className="text-xs text-stone-500 underline" onClick={props.onRemove}>
        Unflag
      </button>
    </li>
  );
}

/** After a rating: what the scorer would have picked, and where the two rooms differ most. */
function Reveal(props: { saved: RatingSaved; onNext: () => void; onTakeBack: () => void }) {
  const { rating, scorer } = props.saved;
  const agrees = scorer.pick === rating.winner;
  const gaps = differences(scorer.a, scorer.b);
  return (
    <section className="flex flex-col gap-2 rounded-md bg-stone-50 p-3">
      <p>
        Saved: you {PICKED[rating.winner]}. The scorer would have {PICKED[scorer.pick]}
        {agrees ? ' too' : ''} ({scorer.a.score.toFixed(2)} for A, {scorer.b.score.toFixed(2)} for
        B).
      </p>
      {gaps.length > 0 && (
        <ul className="text-stone-600">
          {gaps.map((g) => (
            <li key={g.feature}>
              {FEATURES[g.feature] ?? g.feature}: A {g.a.toFixed(2)}, B {g.b.toFixed(2)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-3">
        <button type="button" className={button(true)} onClick={props.onNext}>
          Next pair <kbd className="opacity-60">N</kbd>
        </button>
        <button type="button" className={button()} onClick={props.onTakeBack}>
          Take it back <kbd className="opacity-60">Backspace</kbd>
        </button>
      </div>
    </section>
  );
}

/** Why the page can't show a pair: signed out, not an admin, or something else. */
function Refused({ error }: { error: Error }) {
  if (error instanceof ApiError && error.code === 'sign_in_required') {
    return <SignIn what="rate layouts" lead="Sign in to rate layouts: the page is for admins." />;
  }
  if (error instanceof ApiError && error.code === 'admin_only') {
    return (
      <p>
        Only admins can rate layouts. Add the email you sign in with to <code>ADMIN_EMAILS</code> in{' '}
        <code>.env</code>, then restart the API.
      </p>
    );
  }
  return <p className="text-red-700">{error.message}</p>;
}
