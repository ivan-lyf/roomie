import * as RM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

/** A small menu under a button: View options, the account. */
export function Menu({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <RM.Root modal={false}>
      <RM.Trigger asChild>{trigger}</RM.Trigger>
      <RM.Portal>
        <RM.Content
          sideOffset={6}
          align="end"
          className="z-50 min-w-48 animate-panel-in bg-surface p-1 shadow-panel"
        >
          {children}
        </RM.Content>
      </RM.Portal>
    </RM.Root>
  );
}

export function MenuItem({ onSelect, children }: { onSelect: () => void; children: ReactNode }) {
  return (
    <RM.Item
      onSelect={onSelect}
      className="cursor-pointer rounded-control px-3 py-2 text-[15px] outline-none data-highlighted:bg-accent-tint"
    >
      {children}
    </RM.Item>
  );
}

export function MenuCheck({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <RM.CheckboxItem
      checked={checked}
      onCheckedChange={onChange}
      onSelect={(e) => e.preventDefault()}
      className="flex cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-[15px] outline-none data-highlighted:bg-accent-tint"
    >
      <span
        aria-hidden
        className="flex size-4 items-center justify-center border border-ink text-xs leading-none"
      >
        {checked ? '✓' : ''}
      </span>
      {children}
    </RM.CheckboxItem>
  );
}

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <RM.Label className="px-3 py-2 font-mono text-xs text-ink-muted">{children}</RM.Label>
);
