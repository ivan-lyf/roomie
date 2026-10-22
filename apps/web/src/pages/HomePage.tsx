import { Floorplan } from '@roomie/schema';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { fetchFloorplan, floorplanImageUrl } from '../api';
import { HomeScene } from '../scene/home/HomeScene';
import { useFloorplan } from '../stores/floorplan';
import { HomePanel } from '../ui/HomePanel';

/** The plan that comes with the app, to try things on. */
const DEMO_ID = 'demo';

/** A plan from the API, or the built-in demo, checked like anything else read from storage. */
async function readPlan(id: string, signal: AbortSignal): Promise<Floorplan> {
  if (id !== DEMO_ID) return fetchFloorplan(id, signal);
  const parsed = Floorplan.safeParse(demo);
  if (!parsed.success) throw new Error('The demo floor plan is invalid.');
  return parsed.data;
}

export function HomePage({ id }: { id: string }) {
  const [read, setRead] = useState<{ id: string; error?: string }>();
  const load = useFloorplan((s) => s.load);
  const plan = useFloorplan((s) => s.plan);
  const [roomId, setRoomId] = useState(
    () => new URLSearchParams(location.search).get('room') ?? undefined,
  );
  const [cutaway, setCutaway] = useState(true);
  const [ceilings, setCeilings] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    readPlan(id, ctrl.signal)
      .then((plan) => {
        load(plan);
        setRead({ id: plan.id });
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setRead({ id, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [id, load]);

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

  if (read?.error) {
    return (
      <p className="p-8 text-sm text-stone-700">
        {read.error}{' '}
        <Link href="/" className="underline">
          Back to your plans
        </Link>
      </p>
    );
  }
  // The store may still hold the plan from another page.
  if (!plan || !read || plan.id !== read.id) return null;
  if (plan.walls.length === 0) return <NotTraced plan={plan} />;
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

/** An uploaded plan that has no walls yet: its image, and what comes next. */
function NotTraced({ plan }: { plan: Floorplan }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8 text-sm text-stone-800">
      <h1 className="text-xl font-semibold">{plan.name}</h1>
      <p className="text-stone-600">
        Uploaded. Its walls, doors and rooms haven't been read yet: the plan reader and the editor
        to check its work are the next steps.{' '}
        <Link href="/" className="underline">
          Back to your plans
        </Link>
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
