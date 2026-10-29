import { area } from '@roomie/geometry';
import type { Floorplan } from '@roomie/schema';
import { useState } from 'react';
import { Link } from 'wouter';
import { useStore } from 'zustand';
import { formatPrice, ROOM_TYPES, squareMeters } from '../format';
import {
  furnitureTotals,
  problemsByRoom,
  type Totals,
  useLayoutProblems,
  useScores,
} from '../furnishing';
import { DEMO_ID } from '../plans';
import { redo, undo, useFloorplan } from '../stores/floorplan';
import { useIntents } from '../stores/intents';
import { useProducts } from '../stores/products';
import { FurnishPanel } from './FurnishPanel';
import { LookControls } from './LookControls';

type Props = {
  /** The plan's id in the URL ('demo' for the demo). */
  id: string;
  plan: Floorplan;
  roomId: string | undefined;
  onRoom: (roomId: string | undefined) => void;
  cutaway: boolean;
  onCutaway: (on: boolean) => void;
  ceilings: boolean;
  onCeilings: (on: boolean) => void;
};

export function HomePanel(props: Props) {
  const { plan, roomId, onRoom } = props;
  const [tab, setTab] = useState<'home' | 'furnish'>('home');
  const products = useProducts((s) => s.byArticle);
  const { home } = furnitureTotals(plan.furniture, products);
  const budget = useIntents((s) => s.furnishing?.budgetCad ?? undefined);
  const score = useScores(plan).now.home.score;
  return (
    <aside className="m-4 flex w-96 shrink-0 flex-col gap-3 overflow-y-auto rounded-xl bg-white p-4 text-sm text-stone-800 shadow-lg">
      <div className="flex items-center justify-between text-xs">
        <Link href="/" className="text-stone-500 hover:text-stone-800">
          ← Plans
        </Link>
        <UndoRedo />
        <Link href={`/plans/${props.id}/edit`} className="underline">
          Edit the plan
        </Link>
      </div>
      <header>
        <h1 className="text-base font-semibold">{plan.name}</h1>
        {home.count > 0 && (
          <>
            <p className="text-stone-500">
              {furnished(home)} in all
              {budget !== undefined && ` of a ${formatPrice(budget)} budget`} · prices from IKEA.ca,
              check before buying
            </p>
            {budget !== undefined && home.priceCad > budget && (
              <p className="text-amber-700">{formatPrice(home.priceCad - budget)} over budget.</p>
            )}
            <p className="text-xs text-stone-500">Layout score {score.toFixed(2)}</p>
          </>
        )}
      </header>

      <nav className="flex gap-1 rounded-lg bg-stone-100 p-1" aria-label="Panels">
        {(['home', 'furnish'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`flex-1 rounded-md px-2 py-1 ${tab === t ? 'bg-white shadow-sm' : 'text-stone-600'}`}
          >
            {t === 'home' ? 'Rooms & look' : 'Furnish'}
          </button>
        ))}
      </nav>

      {tab === 'furnish' ? (
        <FurnishPanel plan={plan} roomId={roomId} onRoom={onRoom} saved={props.id !== DEMO_ID} />
      ) : (
        <HomeTab {...props} />
      )}
    </aside>
  );
}

/** Undo and Redo for every edit to the home, each greyed out when there's nothing to take. */
function UndoRedo() {
  const canUndo = useStore(useFloorplan.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useFloorplan.temporal, (s) => s.futureStates.length > 0);
  const button = 'underline disabled:text-stone-300 disabled:no-underline';
  return (
    <span className="flex gap-3">
      <button type="button" className={button} onClick={undo} disabled={!canUndo} title="Ctrl+Z">
        Undo
      </button>
      <button
        type="button"
        className={button}
        onClick={redo}
        disabled={!canRedo}
        title="Ctrl+Shift+Z"
      >
        Redo
      </button>
    </span>
  );
}

/** "3 items, $1,249.00" */
const furnished = ({ count, priceCad }: Totals) =>
  `${count} item${count === 1 ? '' : 's'}, ${formatPrice(priceCad)}`;

function HomeTab(props: Props) {
  const { plan, roomId, onRoom } = props;
  const products = useProducts((s) => s.byArticle);
  const { byRoom } = furnitureTotals(plan.furniture, products);
  const problems = problemsByRoom(useLayoutProblems(plan).all, plan.furniture);
  const total = plan.rooms.reduce((sum, room) => sum + area(room.boundary), 0);
  const item = (selected: boolean) =>
    `w-full px-3 py-2 text-left ${selected ? 'bg-stone-100' : 'hover:bg-stone-50'}`;
  return (
    <>
      <ul className="divide-y divide-stone-200 rounded-md border border-stone-200">
        <li>
          <button type="button" onClick={() => onRoom(undefined)} className={item(!roomId)}>
            <span className="block font-medium">Whole home</span>
            <span className="block text-xs text-stone-500">
              {plan.rooms.length} rooms · {squareMeters(total)}
            </span>
          </button>
        </li>
        {plan.rooms.map((room) => (
          <li key={room.id}>
            <button
              type="button"
              onClick={() => onRoom(room.id)}
              className={item(room.id === roomId)}
            >
              <span className="block font-medium">{room.name}</span>
              <span className="block text-xs text-stone-500">
                {ROOM_TYPES[room.roomType]} · {squareMeters(area(room.boundary))}
                {byRoom.has(room.id) && ` · ${furnished(byRoom.get(room.id)!)}`}
                {problems.has(room.id) && (
                  <span className="text-red-700">
                    {' '}
                    · {problems.get(room.id)} problem{problems.get(room.id) === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <LookControls plan={plan} roomId={roomId} />

      <fieldset className="space-y-1">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.cutaway}
            onChange={(e) => props.onCutaway(e.target.checked)}
          />
          Lower the walls in front
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.ceilings}
            onChange={(e) => props.onCeilings(e.target.checked)}
          />
          Ceilings, seen from inside a room
        </label>
      </fieldset>

      <p className="text-xs text-stone-500">
        Click a room to look into it; Esc goes back to the whole home. Drag to turn, scroll to zoom.
      </p>
    </>
  );
}
