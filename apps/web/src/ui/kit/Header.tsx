import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Link } from 'wouter';

/** The wordmark, back to Your homes. */
export const Wordmark = ({ href = '/homes' }: { href?: string }) => (
  <Link href={href} className="text-xl font-bold tracking-tight text-ink no-underline">
    ROOMIE
  </Link>
);

/** The bar along the top of every page: a strong rule under it, like a plan sheet's title block. */
export function Header({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <header
      className={clsx(
        'flex flex-wrap items-center gap-8 border-b-2 border-rule bg-canvas px-8 py-4',
        className,
      )}
    >
      <Wordmark />
      {children}
    </header>
  );
}
