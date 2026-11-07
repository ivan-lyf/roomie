import { turn } from '@roomie/geometry';
import { FURNISHABLE } from '@roomie/schema';
import { useEffect, useState } from 'react';
import { Link, Redirect } from 'wouter';
import { useAutosave } from '../autosave';
import { familyName } from '../catalog';
import { isImperial } from '../format';
import { nudgeItem, removeItem, rotateItem } from '../furnishing';
import { useFurnishingProgress } from '../generation';
import { DEMO_ID, usePlan } from '../plans';
import { HomeScene } from '../scene/home/HomeScene';
import { redo, undo, useFloorplan } from '../stores/floorplan';
import { useFurnish } from '../stores/furnish';
import { useIntents } from '../stores/intents';
import { useProducts, useProductsFor } from '../stores/products';
import { useWorkspace } from '../stores/workspace';
import { useToast } from '../ui/kit';
import { AddSheet } from '../ui/workspace/AddSheet';
import { ContextPanel } from '../ui/workspace/ContextPanel';
import { FurnishingCard } from '../ui/workspace/FurnishingCard';
import { RoomRail } from '../ui/workspace/RoomRail';
import { SwapSheet } from '../ui/workspace/SwapSheet';
import { Tips } from '../ui/workspace/Tips';
import { TopBar } from '../ui/workspace/TopBar';
import { ViewControls } from '../ui/workspace/ViewControls';

/** R turns an item a quarter, Shift+R by 15°. */
const STEP = Math.PI / 2;
const STEP_FINE = Math.PI / 12;
/** Arrows move an item 5 cm across the plan, Shift+arrows 25 cm. */
const NUDGE = 0.05;
const NUDGE_FAR = 0.25;
const NUDGES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Removes an item, with a toast to take it back (§4.6): no confirmation, since undo can. */
function removeWithUndo(itemId: string) {
  const plan = useFloorplan.getState().plan;
  const item = plan?.furniture.find((f) => f.id === itemId);
  const product = item && useProducts.getState().byArticle.get(item.articleNo);
  removeItem(itemId);
  useToast.getState().show(`${product ? familyName(product) : 'Piece'} removed`, {
    label: 'Undo',
    run: undo,
  });
}

/** Your home (§4.6): look at the result, understand it, and change it. */
export function HomePage({ id }: { id: string }) {
  const { plan, error } = usePlan(id);
  // Wall colours, floors and lights are saved like any other edit.
  const save = useAutosave(id);
  const [roomId, setRoomId] = useState(
    () => new URLSearchParams(location.search).get('room') ?? undefined,
  );
  // The products the furniture needs, saved homes holding items the catalog has since dropped,
  // and those it was furnished with, to score each room as it was.
  const planned = useIntents((s) => s.furnishing);
  useProductsFor(
    [...(plan?.furniture ?? []), ...(planned?.rooms.flatMap((r) => r.placements) ?? [])].map(
      (f) => f.articleNo,
    ),
  );
  const { view, cutaway, ceilings, resets, imperial: chosenUnits } = useWorkspace();
  const busy = useFurnish((s) => s.busy);
  const imperial = chosenUnits ?? isImperial(plan?.scale?.sourceUnit);

  // Keep the room in the URL, so a view can be linked to.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (roomId) params.set('room', roomId);
    else params.delete('room');
    history.replaceState(null, '', params.size > 0 ? `?${params}` : location.pathname);
  }, [roomId]);

  // Esc stops placing, else closes a sheet, else lets go of the piece, else goes back to the
  // whole home. R turns what's being placed or the piece selected, S opens its swap drawer,
  // Delete removes it, arrows nudge it (§4.6).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Keys typed into a field are the field's; a ticked checkbox leaves them to the page.
      const field = 'input:not([type=checkbox]):not([type=radio]), select, textarea, [role=dialog]';
      if (e.target instanceof HTMLElement && e.target.closest(field)) return;
      const furnish = useFurnish.getState();
      const workspace = useWorkspace.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // While a furnishing is under way, the furniture stays as it is.
      if (furnish.busy && e.key !== 'Escape') return;
      if (mod && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod || e.altKey) return;
      const item = furnish.selected;
      const by = e.shiftKey ? STEP_FINE : STEP;
      if (e.key === 'Escape') {
        if (furnish.armed) furnish.arm(undefined);
        else if (workspace.sheet) workspace.set({ sheet: undefined });
        else if (item) furnish.select(undefined);
        else setRoomId(undefined);
      } else if (key === 's' && item) {
        workspace.set({ sheet: workspace.sheet === 'swap' ? undefined : 'swap' });
      } else if (key === 'r' && furnish.armed) {
        furnish.turnArmed(turn(furnish.armed.rotation, by));
      } else if (key === 'r' && item) {
        rotateItem(item, by);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && item) {
        removeWithUndo(item);
      } else if (e.key in NUDGES && item) {
        e.preventDefault();
        const [dx, dy] = NUDGES[e.key]!;
        const step = e.shiftKey ? NUDGE_FAR : NUDGE;
        nudgeItem(item, dx * step, dy * step);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useFurnishingProgress();
  // Picking, placing and the view start afresh on each home.
  useEffect(
    () => () => {
      useFurnish.getState().reset();
      useWorkspace.getState().reset();
    },
    [id],
  );
  // What its furnishings planned, for why each piece is there; the demo was never furnished.
  useEffect(() => void useIntents.getState().load(id === DEMO_ID ? undefined : id), [id]);

  if (error) {
    return (
      <main className="p-8 text-lg">
        We couldn&apos;t open this home.{' '}
        <Link href="/homes" className="underline">
          Back to your homes
        </Link>
      </main>
    );
  }
  if (!plan) {
    return (
      <main aria-live="polite" className="p-8 text-ink-muted">
        Opening your home…
      </main>
    );
  }
  if (plan.walls.length === 0 || !plan.scale) return <Redirect to={`/plans/${id}/check`} replace />;
  const firstRoom = plan.rooms.find((r) => FURNISHABLE.has(r.roomType))?.id ?? plan.rooms[0]?.id;
  return (
    <div className="flex h-full flex-col">
      <TopBar id={id} plan={plan} imperial={imperial} save={save} />
      <main className="flex min-h-0 flex-1">
        <RoomRail id={id} plan={plan} roomId={roomId} onRoom={setRoomId} />
        <div className="relative min-w-0 flex-1">
          <HomeScene
            plan={plan}
            roomId={roomId}
            onRoom={setRoomId}
            cutaway={cutaway}
            ceilings={ceilings}
            top={view === 'top'}
            resets={resets}
          />
          <div className="pointer-events-none absolute top-4 left-4">
            <FurnishingCard plan={plan} />
          </div>
          <div className="pointer-events-none absolute top-4 right-4">
            <Tips show={plan.furniture.length > 0 && !busy} />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <ViewControls roomId={roomId} firstRoom={firstRoom} onRoom={setRoomId} />
          </div>
        </div>
        <ContextPanel id={id} plan={plan} roomId={roomId} imperial={imperial} saved={id !== DEMO_ID} />
      </main>
      <SwapSheet plan={plan} imperial={imperial} />
      <AddSheet plan={plan} roomId={roomId} imperial={imperial} />
    </div>
  );
}
