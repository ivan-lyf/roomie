import {
  type Category,
  FURNISHABLE,
  type Floorplan,
  GenerationInputs,
  StylePreset,
} from '@roomie/schema';
import { clsx } from 'clsx';
import { type ReactNode, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { startFurnishing } from '../api';
import { supabase } from '../auth';
import { useAutosave } from '../autosave';
import { roomSides } from '../check';
import { mustHavesFor, ROOM_ICONS } from '../copy';
import { formatDollars, formatSides } from '../format';
import { runFurnishing } from '../generation';
import { DEMO_ID, usePlan } from '../plans';
import { anchors, defaultBudget, isTight, STYLE_CARDS, tierOf } from '../preferences';
import { useAccount } from '../stores/account';
import { resumeAfterSignIn, takeResume, useSignIn } from '../ui/account/signIn';
import { Button, ButtonLink, Caption, Chip, Header, Notice, Slider, StepBar } from '../ui/kit';
import { StyleTile } from '../ui/preferences/StyleTile';
import { SaveLabel } from '../ui/SaveLabel';

type Choices = {
  off: string[];
  budget?: number;
  style: StylePreset;
  /** Per room, the chips picked, by label. */
  needs: Record<string, string[]>;
};

const START: Choices = { off: [], style: 'scandinavian', needs: {} };

/** What was picked for this home, kept for the tab: going back, or coming back signed in. */
function remembered(id: string): Choices {
  try {
    const raw = sessionStorage.getItem(`roomie.prefs.${id}`);
    return raw ? { ...START, ...(JSON.parse(raw) as Partial<Choices>) } : START;
  } catch {
    return START;
  }
}

function remember(id: string, choices: Choices) {
  try {
    sessionStorage.setItem(`roomie.prefs.${id}`, JSON.stringify(choices));
  } catch {
    // Not kept: the page starts from the defaults next time.
  }
}

/** Rooms, budget, style and must-haves on one page; every field filled in already (§4.4). */
export function PreferencesPage({ id }: { id: string }) {
  const { plan, error } = usePlan(id);
  const save = useAutosave(id);
  return (
    <div className="min-h-full bg-canvas">
      <Header>
        <StepBar id={id} current="preferences" />
        <span className="ml-auto">
          <SaveLabel {...save} />
        </span>
      </Header>
      <main className="mx-auto max-w-[1040px] px-8 pt-10 pb-20">
        {error ? (
          <p className="m-0 text-lg">
            We couldn&apos;t open this plan.{' '}
            <Link href="/homes" className="underline">
              Back to your homes
            </Link>
          </p>
        ) : plan ? (
          <Preferences plan={plan} />
        ) : (
          <p aria-live="polite" className="m-0 text-ink-muted">
            Opening your plan…
          </p>
        )}
      </main>
    </div>
  );
}

function Preferences({ plan }: { plan: Floorplan }) {
  const id = plan.id;
  const [, navigate] = useLocation();
  const email = useAccount((s) => s.email);
  const openSignIn = useSignIn((s) => s.open);
  const [choices, setChoices] = useState<Choices>(() => remembered(id));
  const [problem, setProblem] = useState<string>();
  const imperial = plan.scale?.sourceUnit === 'imperial';

  const rooms = useMemo(
    () => plan.rooms.filter((r) => r.furnishable && FURNISHABLE.has(r.roomType)),
    [plan.rooms],
  );
  const chosen = rooms.filter((r) => !choices.off.includes(r.id));
  const range = anchors(chosen.length);
  const budget = Math.round(
    Math.min(range.Generous, Math.max(range.Essentials / 2, choices.budget ?? defaultBudget(chosen.length))),
  );
  const { tier, line } = tierOf(budget, chosen.length);
  const needCount = chosen.reduce((n, r) => n + (choices.needs[r.id]?.length ?? 0), 0);
  const update = (change: Partial<Choices>) => {
    const next = { ...choices, ...change };
    setChoices(next);
    remember(id, next);
  };

  const asked = (): GenerationInputs => {
    const musts = (roomId: string, type: Parameters<typeof mustHavesFor>[0]) =>
      mustHavesFor(type)
        .filter((m) => choices.needs[roomId]?.includes(m.label))
        .flatMap((m) => m.categories) as Category[];
    return GenerationInputs.parse({
      roomIds: chosen.map((r) => r.id),
      budgetCad: budget,
      style: choices.style,
      mustHaves: Object.fromEntries(chosen.map((r) => [r.id, musts(r.id, r.roomType)])),
    });
  };

  /** Starts furnishing, and goes to the home to watch it fill in (§4.5). */
  const begin = (inputs: GenerationInputs) => {
    void runFurnishing(id, inputs.roomIds, undefined, () => startFurnishing(id, inputs), inputs);
    navigate(`/plans/${id}`);
  };

  // Back from signing in with Google: the furnishing asked for goes ahead by itself.
  const onSignedIn = useEffectEvent(() => {
    if (takeResume() === `furnish:${id}`) begin(asked());
  });
  useEffect(() => {
    if (email) onSignedIn();
  }, [email]);

  if (id === DEMO_ID) {
    return (
      <Notice tone="info">
        This is the built-in example. Use &ldquo;Try a sample apartment&rdquo; on{' '}
        <Link href="/homes" className="underline">
          Your homes
        </Link>{' '}
        for a copy you can furnish.
      </Notice>
    );
  }
  if (plan.status !== 'ready') {
    return (
      <Notice tone="warn">
        Your plan needs a quick check before we can furnish it.{' '}
        <Link href={`/plans/${id}/check`} className="font-semibold underline">
          Check your plan
        </Link>
      </Notice>
    );
  }
  if (rooms.length === 0) {
    return (
      <Notice tone="warn">
        None of your rooms are ones we furnish yet: we furnish living rooms, bedrooms, studios, dining
        areas and dens.{' '}
        <Link href={`/plans/${id}/check?step=2`} className="font-semibold underline">
          Say what your rooms are for
        </Link>
      </Notice>
    );
  }

  const furnish = () => {
    setProblem(undefined);
    if (chosen.length === 0) return setProblem('Pick at least one room to furnish.');
    if (!supabase || email) return begin(asked());
    resumeAfterSignIn(`furnish:${id}`);
    openSignIn({ reason: 'step', then: () => begin(asked()) });
  };

  return (
    <div className="flex flex-col">
      <h1 className="m-0 mb-8 text-[32px] font-bold tracking-tight">Your preferences</h1>
      <ol className="m-0 list-none border-t-2 border-rule p-0">
        <Row n={1} title="Which rooms should we furnish?">
          <div className="flex flex-wrap gap-2">
            {rooms.map((r) => {
              const Icon = ROOM_ICONS[r.roomType];
              const on = !choices.off.includes(r.id);
              const { width, depth } = roomSides(plan, r.boundary);
              return (
                <Chip
                  key={r.id}
                  pressed={on}
                  onClick={() =>
                    update({ off: on ? [...choices.off, r.id] : choices.off.filter((o) => o !== r.id) })
                  }
                >
                  <Icon size={18} aria-hidden />
                  {r.name}
                  <span className="font-mono text-[13px] font-normal">{formatSides(width, depth, imperial)}</span>
                </Chip>
              );
            })}
          </div>
          {chosen.length === 0 && (
            <p role="alert" className="m-0 text-danger">
              Pick at least one room to furnish.
            </p>
          )}
        </Row>

        <Row n={2} title="What's your budget for everything?">
          <div className="flex max-w-[640px] flex-col gap-3">
            <div className="flex items-center gap-4">
              <span className="font-mono text-sm text-ink-muted">Essentials</span>
              <Slider
                label="Budget"
                min={Math.round(range.Essentials / 2)}
                max={range.Generous}
                step={50}
                value={budget}
                valueText={formatDollars(budget)}
                onChange={(v) => update({ budget: v })}
              />
              <span className="font-mono text-sm text-ink-muted">Generous</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 font-mono text-lg">
                <span aria-hidden>$</span>
                <span className="sr-only">Budget in dollars</span>
                <BudgetInput budget={budget} onChange={(v) => update({ budget: v })} />
              </label>
              <span className="font-semibold">{tier}</span>
            </div>
            <p className="m-0 text-ink-muted">{line}</p>
            {isTight(budget, chosen.length, needCount) && (
              <Notice tone="warn">
                That&apos;s tight for {chosen.length} {chosen.length === 1 ? 'room' : 'rooms'};
                we&apos;ll keep to the essentials.
              </Notice>
            )}
          </div>
        </Row>

        <Row n={3} title="Pick a style">
          <div role="radiogroup" aria-label="Style" className="grid grid-cols-3 gap-5">
            {StylePreset.options.map((s) => {
              const on = choices.style === s;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => update({ style: s })}
                  className={clsx(
                    'flex flex-col border-2 bg-surface text-left',
                    on ? 'border-accent' : 'border-line hover:border-ink',
                  )}
                >
                  <StyleTile style={s} />
                  <span className="flex flex-col gap-1 border-t border-line px-4 py-3">
                    <span className="font-semibold">
                      {on && '✓ '}
                      {STYLE_CARDS[s].title}
                    </span>
                    <span className="text-sm text-ink-muted">{STYLE_CARDS[s].line}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Row>

        <Row n={4} title="Anything you need?" hint="Optional">
          <div className="flex flex-col gap-4">
            {chosen.map((r) => (
              <div key={r.id} className="flex flex-col gap-2">
                <Caption>{r.name}</Caption>
                <div className="flex flex-wrap gap-2">
                  {mustHavesFor(r.roomType).map((m) => {
                    const on = choices.needs[r.id]?.includes(m.label) ?? false;
                    const list = choices.needs[r.id] ?? [];
                    return (
                      <Chip
                        key={m.label}
                        pressed={on}
                        onClick={() =>
                          update({
                            needs: {
                              ...choices.needs,
                              [r.id]: on ? list.filter((l) => l !== m.label) : [...list, m.label],
                            },
                          })
                        }
                      >
                        {on ? '✓' : '+'} {m.label}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Row>
      </ol>

      <div className="flex flex-wrap items-center justify-end gap-6 pt-8">
        <span className="font-mono text-sm text-ink-muted">Usually ready in under 3 minutes</span>
        {problem && (
          <span role="alert" className="text-danger">
            {problem}
          </span>
        )}
        <Button size="lg" onClick={furnish} disabled={chosen.length === 0}>
          Furnish my home →
        </Button>
      </div>
      <ButtonLink href={`/plans/${id}/check`} variant="link" className="mt-4 self-start text-[15px]">
        ← Back to the check
      </ButtonLink>
    </div>
  );
}

function Row({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 border-b border-rule py-7">
      <span className="font-mono text-sm text-accent">{String(n).padStart(2, '0')}</span>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-2xl font-bold tracking-tight">
          {title}
          {hint && <span className="ml-3 font-mono text-sm font-normal text-ink-muted">{hint}</span>}
        </h2>
        {children}
      </section>
    </li>
  );
}

/** The budget as typed: kept as text while it's edited, so it isn't held to the slider's range. */
function BudgetInput({ budget, onChange }: { budget: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string>();
  const commit = () => {
    const v = Number((text ?? '').replace(/[^\d]/g, ''));
    if (v > 0) onChange(v);
    setText(undefined);
  };
  return (
    <input
      inputMode="numeric"
      value={text ?? String(budget)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="w-28 rounded-control border border-line-strong bg-surface px-3 py-2 tabular-nums"
    />
  );
}
