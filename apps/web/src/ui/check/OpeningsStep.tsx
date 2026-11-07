import { planStatus, validateFloorplan } from '@roomie/geometry';
import type { Floorplan } from '@roomie/schema';
import { AlertCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { planProblemText } from '../../copy';
import { Button, Notice } from '../kit';
import type { Highlight } from './PlanSheet';
import { useHighlight } from './highlight';

type Props = {
  plan: Floorplan;
  onHighlight: (h: Highlight) => void;
  done: () => void;
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Step 3, doors and windows, and anything left to check before furnishing (§4.3). */
export function OpeningsStep({ plan, onHighlight, done }: Props) {
  const [focus, setFocus] = useState<string[]>();
  const problems = useMemo(
    () => validateFloorplan(plan).filter((p) => p.code !== 'no_scale'),
    [plan],
  );
  const names = useMemo(() => new Map(plan.rooms.map((r) => [r.id, r.name])), [plan.rooms]);
  useHighlight(onHighlight, { openings: true, ...(focus && { focus }) });

  const doors = plan.openings.filter((o) => o.kind === 'door').length;
  const windows = plan.openings.filter((o) => o.kind === 'window').length;
  const passages = plan.openings.filter((o) => o.kind === 'passage').length;
  const ready = planStatus(plan) === 'ready';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="m-0 text-2xl font-semibold">Doors and windows</h1>
      <p className="m-0 text-lg leading-normal">
        We found <strong>{count(doors, 'door', 'doors')}</strong>
        {passages > 0 && (
          <>
            , <strong>{count(passages, 'open doorway', 'open doorways')}</strong>
          </>
        )}{' '}
        and <strong>{count(windows, 'window', 'windows')}</strong>. Furniture will keep doors free
        and leave space to open them.
      </p>
      <div className="flex gap-5 text-sm text-ink-muted">
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-4 bg-[#2563a6]" />
          Doors
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-4 bg-[#d18a1e]" />
          Windows
        </span>
      </div>
      {problems.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="m-0 font-semibold">Things to check</p>
          {problems.map((p, i) => (
            <button
              key={`${p.code}-${i}`}
              type="button"
              onClick={() => setFocus(p.ids.length > 0 ? p.ids : undefined)}
              className="flex items-start gap-2.5 border border-warn-line bg-warn-tint p-3 text-left"
            >
              <AlertCircle size={20} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <span>{planProblemText(p, names)}</span>
            </button>
          ))}
        </div>
      )}
      {ready ? (
        <Button className="self-start" onClick={done}>
          Looks good, next
        </Button>
      ) : (
        <Notice tone="warn">
          These need fixing before we can furnish your home. &ldquo;Fix it myself&rdquo; below opens
          the plan to fix them.
        </Notice>
      )}
    </div>
  );
}
