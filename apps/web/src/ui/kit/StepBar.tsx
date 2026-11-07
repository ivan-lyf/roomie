import { clsx } from 'clsx';
import { Fragment } from 'react';
import { Link } from 'wouter';

export type Step = 'plan' | 'check' | 'preferences' | 'home';

const STEPS: { step: Step; label: string; path: (id: string) => string }[] = [
  { step: 'plan', label: 'Plan', path: (id) => `/plans/${id}/check` },
  { step: 'check', label: 'Check', path: (id) => `/plans/${id}/check` },
  { step: 'preferences', label: 'Preferences', path: (id) => `/plans/${id}/preferences` },
  { step: 'home', label: 'Your home', path: (id) => `/plans/${id}` },
];

/** `Plan · Check · Preferences · Your home`: done steps can be clicked to go back (§3). */
export function StepBar({ id, current }: { id: string; current: Step }) {
  const at = STEPS.findIndex((s) => s.step === current);
  return (
    <nav
      aria-label="Steps"
      className="flex items-center gap-2 font-mono text-[13px] tracking-wide uppercase"
    >
      {STEPS.map((s, i) => (
        <Fragment key={s.step}>
          {i > 0 && (
            <span aria-hidden className="text-line-strong">
              ·
            </span>
          )}
          {i < at && s.step !== 'plan' ? (
            <Link href={s.path(id)} className="px-2 py-1.5 font-medium text-ok hover:underline">
              ✓ {s.label}
            </Link>
          ) : (
            <span
              aria-current={i === at ? 'step' : undefined}
              className={clsx(
                'py-1.5',
                i === at
                  ? 'border-b-2 border-accent px-0.5 font-medium text-ink'
                  : i < at
                    ? 'px-2 font-medium text-ok'
                    : 'px-2 text-ink-muted',
              )}
            >
              {i < at ? `✓ ${s.label}` : s.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
