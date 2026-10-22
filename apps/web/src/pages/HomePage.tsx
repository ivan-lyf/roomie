import { Floorplan } from '@roomie/schema';
import { useEffect, useMemo, useState } from 'react';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { HomeScene } from '../scene/home/HomeScene';
import { useFloorplan } from '../stores/floorplan';
import { HomePanel } from '../ui/HomePanel';

/** Plans that come with the app; uploaded plans are stored from Stage 5 of M2. */
const BUILT_IN: Record<string, unknown> = { demo };

/** A built-in plan, checked like anything else read from storage. */
function readBuiltIn(id: string): { plan: Floorplan } | { error: string } {
  if (!(id in BUILT_IN)) return { error: `There's no floor plan called “${id}”.` };
  const parsed = Floorplan.safeParse(BUILT_IN[id]);
  return parsed.success ? { plan: parsed.data } : { error: `This floor plan is invalid.` };
}

export function HomePage({ id }: { id: string }) {
  const read = useMemo(() => readBuiltIn(id), [id]);
  const load = useFloorplan((s) => s.load);
  const plan = useFloorplan((s) => s.plan);
  const [roomId, setRoomId] = useState(
    () => new URLSearchParams(location.search).get('room') ?? undefined,
  );
  const [cutaway, setCutaway] = useState(true);
  const [ceilings, setCeilings] = useState(false);

  useEffect(() => {
    if ('plan' in read) load(read.plan);
  }, [read, load]);

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

  if ('error' in read) {
    return <p className="p-8 text-sm text-stone-700">{read.error}</p>;
  }
  // The store may still hold the plan from another page.
  if (!plan || plan.id !== read.plan.id) return null;
  return (
    <main className="flex h-full">
      <HomePanel
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
