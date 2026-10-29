import { turn } from '@roomie/geometry';
import type { Floorplan } from '@roomie/schema';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { floorplanImageUrl } from '../api';
import { useAutosave } from '../autosave';
import { usePlan } from '../plans';
import { HomeScene } from '../scene/home/HomeScene';
import { useFurnish } from '../stores/furnish';
import { useProductsFor } from '../stores/products';
import { HomePanel } from '../ui/HomePanel';

/** R turns an item a quarter, Shift+R by 15°. */
const STEP = Math.PI / 2;
const STEP_FINE = Math.PI / 12;

export function HomePage({ id }: { id: string }) {
  const { plan, error } = usePlan(id);
  // Wall colors, floors and lights are saved like any other edit.
  useAutosave(id);
  const [roomId, setRoomId] = useState(
    () => new URLSearchParams(location.search).get('room') ?? undefined,
  );
  // The products the furniture needs, saved homes holding items the catalog has since dropped.
  useProductsFor(plan?.furniture.map((f) => f.articleNo) ?? []);
  const [cutaway, setCutaway] = useState(true);
  const [ceilings, setCeilings] = useState(false);

  // Keep the room in the URL, so a view can be linked to.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (roomId) params.set('room', roomId);
    else params.delete('room');
    history.replaceState(null, '', params.size > 0 ? `?${params}` : location.pathname);
  }, [roomId]);

  // Escape stops placing, else lets go of the item, else goes back to the whole home. R turns
  // what's being placed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const furnish = useFurnish.getState();
      if (e.key === 'Escape') {
        if (furnish.armed) furnish.arm(undefined);
        else if (furnish.selected) furnish.select(undefined);
        else setRoomId(undefined);
      } else if ((e.key === 'r' || e.key === 'R') && furnish.armed) {
        furnish.turnArmed(turn(furnish.armed.rotation, e.shiftKey ? STEP_FINE : STEP));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Picking and placing start afresh on each home.
  useEffect(() => () => useFurnish.getState().reset(), [id]);

  if (error) {
    return (
      <p className="p-8 text-sm text-stone-700">
        {error}{' '}
        <Link href="/" className="underline">
          Back to your plans
        </Link>
      </p>
    );
  }
  if (!plan) return null;
  if (plan.walls.length === 0 || !plan.scale) return <NotTraced id={id} plan={plan} />;
  return (
    <main className="flex h-full">
      <HomePanel
        id={id}
        plan={plan}
        roomId={roomId}
        onRoom={setRoomId}
        cutaway={cutaway}
        onCutaway={setCutaway}
        ceilings={ceilings}
        onCeilings={setCeilings}
      />
      <div className="min-w-0 flex-1">
        <HomeScene
          plan={plan}
          roomId={roomId}
          onRoom={setRoomId}
          cutaway={cutaway}
          ceilings={ceilings}
        />
      </div>
    </main>
  );
}

/** An uploaded plan that has no walls yet: its image, and what comes next. */
function NotTraced({ id, plan }: { id: string; plan: Floorplan }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8 text-sm text-stone-800">
      <h1 className="text-xl font-semibold">{plan.name}</h1>
      <p className="text-stone-600">
        Its walls and rooms aren&apos;t traced yet.{' '}
        <Link href={`/plans/${id}/edit`} className="underline">
          Open it in the editor
        </Link>{' '}
        to set its scale and trace it.
      </p>
      {plan.image && (
        <img
          src={floorplanImageUrl(plan.id)}
          alt={`The uploaded plan of ${plan.name}`}
          width={plan.image.width}
          height={plan.image.height}
          className="h-auto w-full rounded-lg border border-stone-200 bg-white"
        />
      )}
    </main>
  );
}
