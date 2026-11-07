import { isTraced } from '@roomie/geometry';
import type { Floorplan } from '@roomie/schema';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import demoImage from '../../../../fixtures/plans/00-demo-1br/plan.png';
import { floorplanImageUrl } from '../api';
import { useAutosave } from '../autosave';
import { refusalText } from '../copy';
import { DEMO_ID, usePlan } from '../plans';
import { usePlanReader } from '../reading';
import { useSignIn } from '../ui/account/signIn';
import { OpeningsStep } from '../ui/check/OpeningsStep';
import { type Highlight, PlanSheet } from '../ui/check/PlanSheet';
import { CantRead, ReadingImage, ReadingSteps } from '../ui/check/ReadingView';
import { RoomsStep } from '../ui/check/RoomsStep';
import { SizeStep } from '../ui/check/SizeStep';
import { Button, ButtonLink, Caption, Header, StepBar } from '../ui/kit';
import { SaveLabel } from '../ui/SaveLabel';

const STEP_NAMES = ['Size', 'Rooms', 'Doors and windows'] as const;

/**
 * Reading the plan, then checking it in three short questions (§4.2, §4.3): its size, its rooms,
 * its doors and windows. "Fix it myself" opens the full editor for anything harder.
 */
export function CheckPage({ id }: { id: string }) {
  const { plan, error } = usePlan(id);
  const save = useAutosave(id);
  const reader = usePlanReader(id, plan);
  const openSignIn = useSignIn((s) => s.open);
  const signIn = reader.read.state === 'signIn';

  // Signed out, reading waits for sign-in, and starts by itself once signed in (reading.ts).
  useEffect(() => {
    if (signIn) openSignIn({ reason: 'step' });
  }, [signIn, openSignIn]);

  if (error) {
    return (
      <Shell id={id}>
        <p className="m-0 text-lg">
          We couldn&apos;t open this plan.{' '}
          <Link href="/homes" className="underline">
            Back to your homes
          </Link>
        </p>
      </Shell>
    );
  }
  if (!plan) {
    return (
      <Shell id={id}>
        <p aria-live="polite" className="m-0 text-ink-muted">
          Opening your plan…
        </p>
      </Shell>
    );
  }

  const imageUrl = id === DEMO_ID ? demoImage : plan.image ? floorplanImageUrl(plan.id) : undefined;
  const read = reader.read;
  const hasDraft = (plan.reading?.draft.walls.length ?? 0) > 0;
  const checkable = isTraced(plan) || hasDraft;
  const waiting =
    read.state === 'reading' ||
    signIn ||
    (read.state === 'idle' && plan.image !== null && plan.reading === null && !isTraced(plan));

  if (!checkable && waiting) {
    return (
      <Shell id={id} step="plan">
        <div className="flex flex-wrap items-center gap-14">
          <div className="min-w-0 flex-[999_1_560px]">
            <ReadingImage imageUrl={imageUrl} />
          </div>
          <div className="flex-[1_1_300px]">
            {signIn ? (
              <section className="flex flex-col gap-4">
                <h1 className="m-0 text-[28px] font-bold tracking-tight">Sign in to read your plan</h1>
                <p className="m-0 text-ink-muted">We start reading as soon as you&apos;re signed in.</p>
                <Button className="self-start" onClick={() => openSignIn({ reason: 'step' })}>
                  Sign in
                </Button>
                <ButtonLink href={`/plans/${id}/edit`} variant="link" className="self-start">
                  Trace it myself instead
                </ButtonLink>
              </section>
            ) : (
              <ReadingSteps />
            )}
          </div>
        </div>
      </Shell>
    );
  }
  if (!checkable) {
    const why =
      read.state === 'failed' && read.code && read.code !== 'sign_in_required'
        ? refusalText(read.code)
        : undefined;
    return (
      <Shell id={id} step="plan">
        <div className="flex flex-wrap items-center gap-14">
          <div className="min-w-0 flex-[999_1_560px]">
            <ReadingImage imageUrl={imageUrl} scanning={false} />
          </div>
          <div className="flex-[1_1_300px]">
            <CantRead
              id={id}
              why={why}
              canRetry={!(read.state === 'failed' && read.noReader)}
            />
          </div>
        </div>
      </Shell>
    );
  }
  return <Wizard id={id} plan={plan} imageUrl={imageUrl} save={<SaveLabel {...save} />} />;
}

function Wizard(props: { id: string; plan: Floorplan; imageUrl: string | undefined; save: React.ReactNode }) {
  const { id, plan } = props;
  const [, navigate] = useLocation();
  const search = useSearch();
  const [step, setStep] = useState(() => {
    const asked = Number(new URLSearchParams(search).get('step'));
    return asked >= 1 && asked <= 3 ? asked : 1;
  });
  const [highlight, setHighlight] = useState<Highlight>({ rooms: true });
  const [imperialChoice, setImperial] = useState<boolean>();
  const imperial =
    imperialChoice ??
    (plan.scale
      ? plan.scale.sourceUnit === 'imperial'
      : (plan.reading?.scaleCandidates ?? []).some((c) => c.sourceUnit === 'imperial'));
  const onHighlight = useCallback((h: Highlight) => setHighlight(h), []);
  // Rooms and doors only make sense once the plan has a size.
  const sized = plan.scale !== null;
  const shown = sized ? step : 1;

  return (
    <Shell id={id} step="check" save={props.save}>
      <div className="flex flex-wrap items-start gap-8">
        <figure className="m-0 flex min-w-0 flex-[999_1_560px] flex-col gap-2">
          <div className="h-[min(68vh,640px)] border border-line bg-surface p-4">
            <PlanSheet
              plan={plan}
              imageUrl={props.imageUrl}
              highlight={highlight}
              label={`Your floor plan, with ${STEP_NAMES[shown - 1]!.toLowerCase()} picked out`}
            />
          </div>
          <Caption>
            Fig. 1 · {plan.name}
          </Caption>
        </figure>
        <section className="flex min-w-0 flex-[1_1_380px] flex-col gap-5 border border-line bg-surface p-7">
          <Caption>
            Step {shown} of 3 · {STEP_NAMES[shown - 1]}
          </Caption>
          {shown === 1 && (
            <SizeStep
              plan={plan}
              imperial={imperial}
              setImperial={setImperial}
              onHighlight={onHighlight}
              next={() => setStep(2)}
            />
          )}
          {shown === 2 && (
            <RoomsStep plan={plan} imperial={imperial} onHighlight={onHighlight} next={() => setStep(3)} />
          )}
          {shown === 3 && (
            <OpeningsStep
              plan={plan}
              onHighlight={onHighlight}
              done={() => navigate(`/plans/${id}/preferences`)}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[15px] text-ink-muted">
            {shown > 1 ? (
              <Button variant="quiet" size="sm" onClick={() => setStep(shown - 1)}>
                ← Back
              </Button>
            ) : (
              <span />
            )}
            <span>
              Something&apos;s off?{' '}
              <Link href={`/plans/${id}/edit`} className="text-ink underline underline-offset-4">
                Fix it myself
              </Link>
            </span>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function Shell(props: {
  id: string;
  step?: 'plan' | 'check';
  save?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-canvas">
      <Header>
        <StepBar id={props.id} current={props.step ?? 'plan'} />
        <span className="ml-auto">{props.save}</span>
      </Header>
      <main className="mx-auto max-w-[1280px] p-8">{props.children}</main>
    </div>
  );
}
