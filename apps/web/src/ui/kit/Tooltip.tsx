import * as RT from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';

export const TooltipProvider = RT.Provider;

/** A short label on hover and focus, for buttons that show only an icon (§5). */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RT.Root delayDuration={300}>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          sideOffset={6}
          className="z-50 rounded-control bg-ink px-2 py-1 font-mono text-xs text-white"
        >
          {label}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** What it does, for the tooltip and for screen readers. */
  label: string;
  pressed?: boolean;
};

/** A button with only an icon in it: always with a tooltip and an `aria-label`. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, pressed, className, children, ...rest },
  ref,
) {
  return (
    <Tooltip label={label}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        className={clsx(
          'inline-flex size-10 items-center justify-center rounded-control text-ink',
          'hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40',
          pressed && 'bg-accent-tint text-accent-ink',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});
