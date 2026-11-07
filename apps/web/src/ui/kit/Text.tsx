import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/** Small mono caps for captions, step labels and figure names: "FIG. 1 · LIVING ROOM". */
export const Caption = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p
    className={clsx(
      'm-0 font-mono text-[13px] font-medium tracking-wide text-ink-muted uppercase',
      className,
    )}
  >
    {children}
  </p>
);

/** A size drawn as a dimension line with end ticks: `├ 7′ 5″ ┤`. */
export function Dimension({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 font-mono text-sm', className)}>
      <span aria-hidden className="h-3 w-px bg-current" />
      <span aria-hidden className="h-px w-3 bg-current" />
      <span className="tabular-nums">{children}</span>
      <span aria-hidden className="h-px w-3 bg-current" />
      <span aria-hidden className="h-3 w-px bg-current" />
    </span>
  );
}

/** A price in the mono face with tabular numbers. */
export const Price = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={clsx('font-mono tabular-nums', className)}>{children}</span>
);

/** A white sheet with a light outline: the plan, a panel. */
export const Panel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={clsx('border border-line bg-surface', className)}>{children}</div>
);

/** A message that says what happened and what to do next. */
export function Notice({
  tone = 'warn',
  children,
  className,
}: {
  tone?: 'warn' | 'danger' | 'ok' | 'info';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'border px-4 py-3 text-[15px] leading-relaxed',
        tone === 'warn' && 'border-warn-line bg-warn-tint text-ink',
        tone === 'danger' && 'border-danger/40 bg-danger-tint text-ink',
        tone === 'ok' && 'border-ok/30 bg-ok-tint text-ink',
        tone === 'info' && 'border-line bg-surface text-ink',
        className,
      )}
    >
      {children}
    </div>
  );
}
