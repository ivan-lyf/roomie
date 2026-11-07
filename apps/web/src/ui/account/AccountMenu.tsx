import { ChevronDown, UserRound } from 'lucide-react';
import { useLocation } from 'wouter';
import { signOut, supabase } from '../../auth';
import { useAccount } from '../../stores/account';
import { Button, Menu, MenuItem, MenuLabel } from '../kit';
import { useSignIn } from './signIn';

/** Top right of the start pages: "Sign in", or the account with a way out. */
export function AccountMenu() {
  const email = useAccount((s) => s.email);
  const admin = useAccount((s) => s.me?.admin);
  const open = useSignIn((s) => s.open);
  const [, navigate] = useLocation();
  if (!supabase || email === undefined) return null;
  if (email === null) {
    return (
      <Button variant="link" className="font-mono text-sm" onClick={() => open({ reason: 'choice' })}>
        Sign in
      </Button>
    );
  }
  return (
    <Menu
      trigger={
        <button
          type="button"
          className="flex items-center gap-2 rounded-control border border-line bg-surface py-1.5 pr-3 pl-1.5 text-[15px]"
        >
          <span aria-hidden className="flex size-7 items-center justify-center bg-accent-tint text-accent-ink">
            <UserRound size={16} />
          </span>
          Your account
          <ChevronDown size={16} aria-hidden />
        </button>
      }
    >
      <MenuLabel>{email || 'Signed in'}</MenuLabel>
      {admin && <MenuItem onSelect={() => navigate('/admin/rate')}>Rate layouts</MenuItem>}
      <MenuItem onSelect={() => void signOut()}>Sign out</MenuItem>
    </Menu>
  );
}
