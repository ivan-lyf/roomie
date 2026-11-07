import { clsx } from 'clsx';
import { type ButtonHTMLAttributes, type ComponentProps, forwardRef } from 'react';
import { Link } from 'wouter';

// One filled blue button per screen; everything else is an outline or an underlined link (§6).

export type ButtonVariant = 'primary' | 'secondary' | 'link' | 'quiet';
export type ButtonSize = 'md' | 'lg' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-sans transition-colors ' +
  'duration-150 disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-semibold text-white hover:bg-accent-ink',
  secondary: 'border-2 border-ink bg-surface font-semibold text-ink hover:bg-canvas',
  link: 'text-ink underline underline-offset-4 hover:text-accent-ink',
  quiet: 'text-ink-muted hover:bg-canvas hover:text-ink',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-5 py-3 text-base',
  lg: 'px-6 py-4 text-lg',
};

export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md') =>
  clsx(base, variants[variant], variant !== 'link' && sizes[size]);

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant, size, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={clsx(buttonClass(variant, size), className)} {...rest} />
  );
});

type LinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

/** A link that looks like a button: for steps that go to another page. */
export function ButtonLink({ variant, size, className, ...rest }: LinkProps) {
  return <Link className={clsx(buttonClass(variant, size), className)} {...rest} />;
}
