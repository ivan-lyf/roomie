import { useState } from 'react';
import { signOut, supabase } from '../auth';
import { useAccount } from '../stores/account';
import { SignIn } from './SignIn';

/** US dollars, as the AI is billed: "$0.12". */
const usd = (amount: number) => `$${amount.toFixed(2)}`;

/**
 * Who's signed in, and what the AI has cost them today against their allowance, with a way to
 * sign out; signed out, a way to sign in. Nothing where sign-in isn't set up.
 */
export function AccountLine() {
  const email = useAccount((s) => s.email);
  const me = useAccount((s) => s.me);
  const [open, setOpen] = useState(false);
  if (!supabase || email === undefined) return null;

  if (email === null) {
    return (
      <div className="space-y-2 text-xs">
        <button type="button" className="text-stone-500 underline" onClick={() => setOpen(!open)}>
          Sign in for the AI steps
        </button>
        {open && <SignIn what="read plans and furnish homes" />}
      </div>
    );
  }
  return (
    <p className="text-xs text-stone-500">
      Signed in as {email || 'you'}
      {me && ` · AI today: ${usd(me.spentUsd)} of ${usd(me.allowanceUsd)} (US)`} ·{' '}
      <button type="button" className="underline" onClick={() => void signOut()}>
        Sign out
      </button>
    </p>
  );
}
