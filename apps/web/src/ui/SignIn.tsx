import { type FormEvent, useState } from 'react';
import { signInWithEmail, signInWithGoogle, supabase } from '../auth';

type Props = {
  /** What the AI would do, to finish "Sign in to have the AI …": "read your plan". */
  what: string;
};

/**
 * Signing in, where an AI step would be: by a link sent by email, or with Google. Either comes
 * back to this page signed in, and the step can go ahead.
 */
export function SignIn({ what }: Props) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string>();
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  if (!supabase) {
    return (
      <p className="text-stone-500">
        The AI can&apos;t {what} here: sign-in isn&apos;t set up. You can do it by hand.
      </p>
    );
  }
  if (sent) {
    return (
      <p className="rounded-md bg-stone-50 p-2">
        Check {sent} for a sign-in link. It brings you back here, signed in.
      </p>
    );
  }

  const send = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setSending(true);
    signInWithEmail(email.trim())
      .then(() => setSent(email.trim()))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSending(false));
  };
  const google = () => {
    setError(undefined);
    signInWithGoogle().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  return (
    <section className="space-y-2 rounded-md border border-stone-200 bg-stone-50 p-2">
      <p>
        Sign in to have the AI {what}. Signing in only keeps what the AI costs in check: your homes
        stay as they are.
      </p>
      <form className="flex gap-2" onSubmit={send}>
        <input
          type="email"
          required
          aria-label="Email"
          placeholder="you@example.com"
          className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white p-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          disabled={sending}
          className="rounded-md bg-stone-800 px-2 py-1 text-white disabled:opacity-50"
        >
          Email me a link
        </button>
      </form>
      <button
        type="button"
        onClick={google}
        className="w-full rounded-md border border-stone-300 bg-white px-2 py-1"
      >
        Continue with Google
      </button>
      {error && <p className="text-red-700">{error}</p>}
    </section>
  );
}
