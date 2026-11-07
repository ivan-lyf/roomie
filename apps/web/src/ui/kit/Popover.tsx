import * as RP from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  /** What the popover points at. */
  anchor: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

/** A small card next to what it describes; it never takes focus or blocks the view (§5). */
export function Popover({ open, anchor, children, side = 'bottom' }: Props) {
  return (
    <RP.Root open={open}>
      <RP.Anchor asChild>{anchor}</RP.Anchor>
      <RP.Portal>
        <RP.Content
          side={side}
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-30 w-64 animate-panel-in bg-surface p-4 text-[15px] shadow-panel"
        >
          {children}
          <RP.Arrow className="fill-ink" />
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
