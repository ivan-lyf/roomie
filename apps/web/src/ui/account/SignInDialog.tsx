import { type FormEvent, useEffect, useState } from 'react';
import { signInWithEmail, signInWithGoogle, supabase } from '../../auth';
import { useAccount } from '../../stores/account';
import { Button, Dialog } from '../kit';
import { forgetResume, useSignIn } from './signIn';

type View = { at: 'choose' } | { at: 'email' } | { at: 'sent'; email: string };

/** The one sign-in dialog: Google or a link by email (§4.8, prototype 8). */
export function SignInDialog() {
  const ask = useSignIn((s) => s.ask);
  const close = useSignIn((s) => s.close);
  const email = useAccount((s) => s.email);
  const [view, setView] = useState<View>({ at: 'choose' });
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Signed in (here, or in another tab with the emailed link): go ahead with the step.
  useEffect(() => {
    if (!ask || !email) return;
    close();
    forgetResume();
    ask.then?.();
  }, [ask, email, close]);

  const onOpenChange = (open: boolean) => {
    if (open) return;
    close();
    forgetResume();
    setView({ at: 'choose' });
    setError(undefined);
  };

  const google = () => {
    setError(undefined);
    signInWithGoogle().catch(() => setError("We couldn't reach Google. Try again in a moment."));
  };
  const send = (e: FormEvent) => {
    e.preventDefault();
    const to = typed.trim();
    setError(undefined);
    setBusy(true);
    signInWithEmail(to)
      .then(() => setView({ at: 'sent', email: to }))
      .catch(() => setError("We couldn't send the link. Check the address and try again."))
      .finally(() => setBusy(false));
  };

  const step = ask?.reason === 'step';
  const title = view.at === 'sent' ? 'Check your email' : step ? 'Sign in to continue' : 'Sign in';
  const description =
    view.at === 'sent'
      ? `We sent a link to ${view.email}. Open it on this device to carry on where you were.`
      : step
        ? 'It keeps things fair: everyone gets a daily share of plan readings and furnishings.'
        : 'Your homes follow you to any device. Until you sign in, they stay in this browser.';

  return (
    <Dialog open={ask !== undefined} onOpenChange={onOpenChange} title={title} description={description}>
      {!supabase ? (
        <p className="text-ink-muted">Signing in isn&apos;t available here.</p>
      ) : view.at === 'choose' ? (
        <div className="flex flex-col gap-3">
          <Button onClick={google}>Continue with Google</Button>
          <Button variant="secondary" onClick={() => setView({ at: 'email' })}>
            Email me a link
          </Button>
        </div>
      ) : view.at === 'email' ? (
        <form className="flex flex-col gap-3" onSubmit={send}>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Your email</span>
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="rounded-control border border-line-strong bg-surface px-3 py-2.5 text-base"
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send me the link'}
          </Button>
          <Button variant="link" onClick={() => setView({ at: 'choose' })}>
            ← Other ways to sign in
          </Button>
        </form>
      ) : (
        <p className="text-[15px] text-ink-muted">
          Nothing there? Check spam, or{' '}
          <Button variant="link" onClick={() => setView({ at: 'email' })}>
            send it again
          </Button>
          .
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
