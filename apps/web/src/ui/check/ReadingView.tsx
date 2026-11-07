import { Check, Circle, MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ButtonLink, Notice } from '../kit';

const STEPS = ['Finding walls', 'Reading room names', 'Finding doors and windows'];

/** While a plan is read: the image with a scanning line, and steps that pass by (§4.2). */
export function ReadingImage({
  imageUrl,
  scanning = true,
}: {
  imageUrl: string | undefined;
  scanning?: boolean;
}) {
  return (
    <div className="relative overflow-hidden border border-line bg-surface p-8">
      {imageUrl ? (
        <img src={imageUrl} alt="Your uploaded floor plan" className="mx-auto max-h-[60vh] opacity-80" />
      ) : (
        <div className="h-80" />
      )}
      {scanning && (
        <div aria-hidden className="absolute inset-x-0 h-0.5 animate-scan bg-accent/60 shadow-[0_0_24px_8px_rgb(29_78_216/0.18)]" />
      )}
    </div>
  );
}

/** The steps are only for show: the reader doesn't report its own, so they pass on a timer. */
export function ReadingSteps() {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAt((i) => Math.min(i + 1, STEPS.length - 1)), 14000);
    return () => clearInterval(t);
  }, []);
  return (
    <section aria-live="polite" className="flex flex-col gap-5">
      <h1 className="m-0 text-[32px] font-bold tracking-tight">Reading your plan</h1>
      <ul className="m-0 flex list-none flex-col gap-3.5 p-0 text-lg">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-3 ${i === at ? 'font-semibold' : i > at ? 'text-ink-muted' : ''}`}>
            {i < at ? (
              <Check size={22} className="text-ok" aria-hidden />
            ) : i === at ? (
              <MoreHorizontal size={22} className="animate-pulse text-accent" aria-hidden />
            ) : (
              <Circle size={20} className="text-line-strong" aria-hidden />
            )}
            {s}
            <span className="sr-only">{i < at ? ', done' : i === at ? ', working on it' : ''}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-ink-muted">This usually takes a minute or two.</p>
    </section>
  );
}

/** When the plan can't be read (§4.2): a clearer image, or tracing it by hand. */
export function CantRead({ id, why, canRetry }: { id: string; why?: string; canRetry: boolean }) {
  return (
    <section className="flex flex-col gap-5">
      <h1 className="m-0 text-[28px] leading-tight font-bold tracking-tight">
        We couldn&apos;t read this plan automatically.
      </h1>
      {why && <Notice tone="warn">{why}</Notice>}
      <p className="m-0 text-ink-muted">
        A sharper image often works. Or trace the walls and rooms yourself over the plan.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {canRetry && (
          <ButtonLink href="/homes" variant="secondary">
            Try a clearer image
          </ButtonLink>
        )}
        <ButtonLink href={`/plans/${id}/edit`}>Trace it myself (about 5 minutes)</ButtonLink>
      </div>
    </section>
  );
}
