import type { Floorplan } from '@roomie/schema';
import { clsx } from 'clsx';
import { Redo2, Undo2 } from 'lucide-react';
import { Link } from 'wouter';
import { useStore } from 'zustand';
import type { SaveState } from '../../autosave';
import { formatDollars } from '../../format';
import { furnitureTotals } from '../../furnishing';
import { redo, undo, useFloorplan } from '../../stores/floorplan';
import { useFurnish } from '../../stores/furnish';
import { useIntents } from '../../stores/intents';
import { useProducts } from '../../stores/products';
import { useWorkspace } from '../../stores/workspace';
import { IconButton, Price, Toggle } from '../kit';
import { SaveLabel } from '../SaveLabel';

type Props = {
  id: string;
  plan: Floorplan;
  imperial: boolean;
  save: { state: SaveState; retry: () => void };
};

/** Back, the home's name, saved or not, undo and redo, units, and the running total (§4.6). */
export function TopBar({ id, plan, imperial, save }: Props) {
  const busy = useFurnish((s) => s.busy);
  const canUndo = useStore(useFloorplan.temporal, (s) => s.pastStates.length > 0) && !busy;
  const canRedo = useStore(useFloorplan.temporal, (s) => s.futureStates.length > 0) && !busy;
  const products = useProducts((s) => s.byArticle);
  const total = furnitureTotals(plan.furniture, products).home.priceCad;
  const budget = useIntents((s) => s.furnishing?.budgetCad ?? undefined);
  const over = budget !== undefined && total > budget + 0.5 ? total - budget : 0;
  const setUnits = useWorkspace((s) => s.set);

  return (
    <header className="flex h-16 shrink-0 items-center gap-5 border-b-2 border-rule bg-canvas px-5">
      <Link href="/homes" className="text-[15px] text-ink-muted hover:text-ink">
        ← Homes
      </Link>
      <input
        key={plan.name}
        defaultValue={plan.name}
        aria-label="Name of this home"
        onBlur={(e) => {
          const name = e.target.value.trim();
          if (name && name !== plan.name) useFloorplan.getState().rename(name);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="w-60 rounded-control border border-transparent px-2 py-1 text-lg font-bold tracking-tight hover:border-line"
      />
      <SaveLabel {...save} />
      <span className="flex items-center">
        <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
          <Undo2 size={20} aria-hidden />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
          <Redo2 size={20} aria-hidden />
        </IconButton>
      </span>
      <Toggle
        label="Units"
        value={imperial ? 'ft' : 'm'}
        onChange={(v) => setUnits({ imperial: v === 'ft' })}
        options={[
          { value: 'ft', label: 'ft' },
          { value: 'm', label: 'm' },
        ]}
      />
      <span className="ml-auto flex items-center gap-4">
        <span className={clsx('text-[15px]', over > 0 ? 'text-warn' : 'text-ink')}>
          Total <Price className="font-medium">{formatDollars(total)}</Price>
          {over > 0 && <span className="ml-2 font-medium">{formatDollars(over)} over your budget</span>}
        </span>
        <Link
          href={`/plans/${id}/list`}
          className="rounded-control border-2 border-ink px-4 py-2 font-semibold text-ink hover:bg-surface"
        >
          Shopping list
        </Link>
      </span>
    </header>
  );
}
