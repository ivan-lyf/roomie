import type { Floorplan } from '@roomie/schema';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { floorplanImageUrl } from '../api';
import { useAutosave } from '../autosave';
import { usePlan } from '../plans';
import { HomeScene } from '../scene/home/HomeScene';
import { HomePanel } from '../ui/HomePanel';

export function HomePage({ id }: { id: string }) {
  const { plan, error } = usePlan(id);
  // Wall colors, floors and lights are saved like any other edit.
  useAutosave(id);
  const [roomId, setRoomId] = useState(
    () => new URLSearchParams(location.search).get('room') ?? undefined,
  );
  const [cutaway, setCutaway] = useState(true);
  const [ceilings, setCeilings] = useState(false);

  // Keep the room in the URL, so a view can be linked to.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (roomId) params.set('room', roomId);
    else params.delete('room');
    history.replaceState(null, '', params.size > 0 ? `?${params}` : location.pathname);
  }, [roomId]);

  // Escape goes back to the whole home.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRoomId(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
