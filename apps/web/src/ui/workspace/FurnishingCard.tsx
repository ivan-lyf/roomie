import type { Floorplan, GenerationInputs } from '@roomie/schema';
import { Check, Circle, Loader2, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { startFurnishing } from '../../api';
import { refusalText } from '../../copy';
import { runFurnishing } from '../../generation';
import { useFurnish } from '../../stores/furnish';
import { useSignIn } from '../account/signIn';
import { Button } from '../kit';

/**
 * Over the home while it's furnished (§4.5): each room as it's done, and for one that couldn't
 * be, why, with a way forward. The rooms that worked are kept.
 */
export function FurnishingCard({ plan }: { plan: Floorplan }) {
  // Only a furnishing of the whole home; a room laid out again reports in its own panel.
  const furnishing = useFurnish((s) => (s.furnishing?.roomId === undefined ? s.furnishing : undefined));
  const openSignIn = useSignIn((s) => s.open);
  const [closed, setClosed] = useState<string>();
  const job = furnishing?.job;
  const key = job?.generationId ?? furnishing?.error;
  if (!furnishing || key === undefined || closed === key) return null;

  const name = (roomId: string) => plan.rooms.find((r) => r.id === roomId)?.name ?? 'room';
  const inputs = furnishing.inputs;
  const again = (change: Partial<GenerationInputs> = {}) => {
    if (!inputs) return;
    const next = { ...inputs, ...change };
    setClosed(key);
    void runFurnishing(plan.id, next.roomIds, undefined, () => startFurnishing(plan.id, next), next);
  };
  const close = () => setClosed(key);

  // It never started: refused, or the plan couldn't be saved first.
  if (!job) {
    const signIn = furnishing.code === 'sign_in_required';
    return (
      <Card onClose={close}>
        <p className="m-0 font-semibold">
          {furnishing.code ? refusalText(furnishing.code) : 'Something went wrong while furnishing.'}
        </p>
        {!furnishing.code && <p className="m-0 text-ink-muted">Your plan and choices are saved.</p>}
        {signIn ? (
          <Button size="sm" className="self-start" onClick={() => openSignIn({ reason: 'step', then: () => again() })}>
            Sign in
          </Button>
        ) : (
          furnishing.code !== 'allowance_reached' &&
          inputs && (
            <Button size="sm" className="self-start" onClick={() => again()}>
              Try again
            </Button>
          )
        )}
      </Card>
    );
  }

  if (job.status === 'failed') {
    return (
      <Card onClose={close}>
        <p className="m-0 font-semibold">Something went wrong while furnishing.</p>
        <p className="m-0 text-ink-muted">Your plan and choices are saved.</p>
        {inputs && (
          <Button size="sm" className="self-start" onClick={() => again()}>
            Try again
          </Button>
        )}
      </Card>
    );
  }

  const running = job.status === 'running';
  const failed = job.rooms.filter((r) => r.status === 'failed');
  const notes = job.rooms.filter((r) => r.status === 'done' && r.reasons?.length);
  return (
    <Card onClose={running ? undefined : close}>
      <p className="m-0 font-semibold" aria-live="polite">
        {running
          ? 'Furnishing your home…'
          : failed.length > 0
            ? 'Most of your home is furnished.'
            : 'Your home is furnished.'}
      </p>
      {running && <p className="m-0 font-mono text-sm text-ink-muted">Usually under 3 minutes</p>}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {job.rooms.map((r) => (
          <li key={r.roomId} className="flex items-center gap-2">
            {r.status === 'done' ? (
              <Check size={18} className="text-ok" aria-hidden />
            ) : r.status === 'failed' ? (
              <TriangleAlert size={18} className="text-warn" aria-hidden />
            ) : running ? (
              <Loader2 size={18} className="animate-spin text-accent" aria-hidden />
            ) : (
              <Circle size={18} className="text-line-strong" aria-hidden />
            )}
            {name(r.roomId)}
            <span className="sr-only">
              {r.status === 'done' ? ', done' : r.status === 'failed' ? ', needs a choice' : ', working on it'}
            </span>
          </li>
        ))}
      </ul>
      {failed.map((r) => (
        <div key={r.roomId} className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="m-0">We couldn&apos;t fit everything you asked for in the {name(r.roomId)}.</p>
          {r.reasons?.map((reason, i) => (
            <p key={i} className="m-0 text-sm text-ink-muted">
              {reason}
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            {inputs && (
              <Button size="sm" onClick={() => again({ budgetCad: Math.round(inputs.budgetCad * 1.25) })}>
                Raise the budget
              </Button>
            )}
            {inputs && (inputs.mustHaves[r.roomId]?.length ?? 0) > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => again({ mustHaves: { ...inputs.mustHaves, [r.roomId]: [] } })}
              >
                Drop what I asked for
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={close}>
              Leave the {name(r.roomId)} empty
            </Button>
          </div>
        </div>
      ))}
      {!running &&
        notes.map((r) =>
          r.reasons!.map((reason, i) => (
            <p key={`${r.roomId}-${i}`} className="m-0 text-sm text-ink-muted">
              {name(r.roomId)}: {reason}
            </p>
          )),
        )}
    </Card>
  );
}

function Card({ children, onClose }: { children: React.ReactNode; onClose?: (() => void) | undefined }) {
  return (
    <section
      aria-label="Furnishing"
      className="pointer-events-auto relative flex w-[24rem] animate-panel-in flex-col gap-3 bg-surface p-5 shadow-panel"
    >
      {onClose && (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-ink-muted hover:text-ink"
        >
          <X size={18} aria-hidden />
        </button>
      )}
      {children}
    </section>
  );
}
