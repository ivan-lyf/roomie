import * as RD from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
};

/** A small dialog in the middle of the screen. It traps focus and closes on Esc (§7). */
export function Dialog({ open, onOpenChange, title, description, children }: Props) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <RD.Content
          className={clsx(
            'fixed top-1/2 left-1/2 z-50 flex w-[min(30rem,calc(100vw-2rem))] -translate-1/2',
            'animate-panel-in flex-col gap-5 border-t-2 border-rule bg-surface p-8 shadow-panel',
          )}
        >
          <RD.Title className="text-2xl font-bold tracking-tight">{title}</RD.Title>
          {description && (
            <RD.Description className="leading-relaxed text-ink-muted">{description}</RD.Description>
          )}
          {children}
          <RD.Close
            aria-label="Close"
            className="absolute top-4 right-4 rounded-control p-1 text-ink-muted hover:text-ink"
          >
            <X size={20} aria-hidden />
          </RD.Close>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** A panel that slides in from the right, over the workspace: swapping, adding furniture. */
export function Sheet({ open, onOpenChange, title, description, children }: Props) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RD.Portal>
        <RD.Content
          onInteractOutside={(e) => e.preventDefault()}
          className={clsx(
            'fixed top-0 right-0 bottom-0 z-40 flex w-[26rem] animate-panel-in flex-col',
            'border-l-2 border-rule bg-surface',
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line p-5">
            <div className="flex flex-col gap-1">
              <RD.Title className="text-xl font-bold tracking-tight">{title}</RD.Title>
              {description ? (
                <RD.Description className="text-sm text-ink-muted">{description}</RD.Description>
              ) : (
                <RD.Description className="sr-only">{title}</RD.Description>
              )}
            </div>
            <RD.Close
              aria-label="Close"
              className="rounded-control p-1 text-ink-muted hover:text-ink"
            >
              <X size={20} aria-hidden />
            </RD.Close>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
