import { clsx } from 'clsx';
import type { SaveState } from '../autosave';
import { Button } from './kit';

const LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  unsaved: 'Saving…',
  saving: 'Saving…',
  failed: "Couldn't save",
  local: 'Sample: changes stay on this page',
};

/** Whether the home is saved, read out politely as it changes (§4.6, §7). */
export function SaveLabel({ state, retry }: { state: SaveState; retry: () => void }) {
  return (
    <span
      aria-live="polite"
      className={clsx('font-mono text-[13px]', state === 'failed' ? 'text-danger' : 'text-ink-muted')}
    >
      {state === 'saved' ? '✓ ' : ''}
      {LABELS[state]}
      {state === 'failed' && (
        <>
          {' · '}
          <Button variant="link" className="text-danger" onClick={retry}>
            Retry
          </Button>
        </>
      )}
    </span>
  );
}
