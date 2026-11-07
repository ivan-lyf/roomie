import { useState } from 'react';
import { useLocation } from 'wouter';
import { copySample } from '../api';
import { rememberHome } from '../homes';
import { Button } from './kit';

/**
 * "Try a sample apartment →": a copy of the sample, the visitor's own, opened at the check. A
 * copy rather than the sample itself, so it can be furnished and kept like any home.
 */
export function SampleLink({ className }: { className?: string }) {
  const [, navigate] = useLocation();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const open = () => {
    setState('busy');
    copySample()
      .then((plan) => {
        rememberHome(plan.id);
        navigate(`/plans/${plan.id}/check`);
      })
      .catch(() => setState('failed'));
  };
  return (
    <>
      <Button variant="link" className={className} disabled={state === 'busy'} onClick={open}>
        {state === 'busy' ? 'Opening the sample…' : 'Try a sample apartment →'}
      </Button>
      {state === 'failed' && (
        <span role="alert" className="text-danger">
          {' '}
          We couldn&apos;t open the sample. Try again in a moment.
        </span>
      )}
    </>
  );
}
