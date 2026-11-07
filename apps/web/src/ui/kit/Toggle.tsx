import { clsx } from 'clsx';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/** Text tabs with an underline on the chosen one: `3D | Top view`, `ft | m` (§6). */
export function Toggle<T extends string>({ label, options, value, onChange, className }: Props<T>) {
  return (
    <div role="group" aria-label={label} className={clsx('flex items-center gap-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'border-b-2 px-2 py-1 font-mono text-sm',
            o.value === value
              ? 'border-accent font-medium text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type ChipProps = {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
};

/** A choice that's on or off, square-cornered (no pills, §6). */
export function Chip({ pressed, onClick, children, disabled }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-2 rounded-control border px-3 py-2 text-[15px]',
        'disabled:opacity-50',
        pressed
          ? 'border-accent bg-accent-tint font-semibold text-accent-ink'
          : 'border-line-strong bg-surface text-ink hover:border-ink',
      )}
    >
      {children}
    </button>
  );
}
