import type { FloorplanStatus, FloorplanSummary } from '@roomie/schema';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { fetchFloorplans, uploadFloorplan } from '../api';
import { useAccount } from '../stores/account';
import { AccountLine } from '../ui/AccountLine';
import { ACCEPTED, preparePlan } from '../upload';

const STATUS: Record<FloorplanStatus, string> = {
  uploaded: 'Not finished',
  needs_calibration: 'Needs its scale',
  ready: 'Ready',
};

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

type Upload =
  { state: 'idle' } | { state: 'busy'; step: string } | { state: 'failed'; error: string };

/** Upload a floor plan, or open one uploaded before. */
export function PlansPage() {
  const [, navigate] = useLocation();
  const [plans, setPlans] = useState<FloorplanSummary[]>();
  const [listError, setListError] = useState<string>();
  const [upload, setUpload] = useState<Upload>({ state: 'idle' });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchFloorplans(ctrl.signal)
      .then(setPlans)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setListError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, []);

  const send = async (file: File | undefined) => {
    if (!file || upload.state === 'busy') return;
    try {
      setUpload({ state: 'busy', step: 'Preparing the image…' });
      const { image, name } = await preparePlan(file);
      setUpload({ state: 'busy', step: 'Uploading…' });
      const plan = await uploadFloorplan(image, name);
      navigate(`/plans/${plan.id}/edit`);
    } catch (e) {
      setUpload({ state: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8 text-sm text-stone-800">
      <header>
        <h1 className="text-2xl font-semibold">Roomie</h1>
        <p className="text-stone-600">
          Turn a floor plan into a 3D home, then furnish it with IKEA Canada products.
        </p>
        <AccountLine />
        <RateLink />
      </header>

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void send(e.dataTransfer.files[0]);
        }}
        className={`flex h-48 flex-col items-center justify-center gap-1 rounded-xl border-2
          border-dashed ${
            dragging
              ? 'border-stone-800 bg-stone-100'
              : 'border-stone-300 bg-white hover:bg-stone-50'
          }`}
      >
        {upload.state === 'busy' ? (
          <span className="font-medium">{upload.step}</span>
        ) : (
          <>
            <span className="font-medium">Drop a floor plan here, or choose a file</span>
            <span className="text-xs text-stone-500">
              PNG, JPEG, WebP or PDF (its first page). Google Gemini reads it.
            </span>
          </>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => void send(e.target.files?.[0])}
      />
      {upload.state === 'failed' && <p className="text-red-700">{upload.error}</p>}

      <section className="space-y-2">
        <h2 className="font-medium">Your plans</h2>
        {listError && <p className="text-red-700">{listError}</p>}
        <ul className="divide-y divide-stone-200 rounded-md border border-stone-200 bg-white">
          <PlanLink
            id="demo"
            ready
            name="Demo one-bedroom"
            detail="A sample plan to try things on"
          />
          {plans?.map((p) => (
            <PlanLink
              key={p.id}
              id={p.id}
              ready={p.status === 'ready'}
              name={p.name}
              detail={`${STATUS[p.status]} · ${when.format(p.updatedAt)}`}
            />
          ))}
        </ul>
      </section>

      <Link href="/catalog" className="text-xs text-stone-500 underline">
        Browse the catalog
      </Link>
    </main>
  );
}

/** A plan: ready ones open in 3D, the rest in the editor, with a link to the other. */
function PlanLink(props: { id: string; name: string; detail: string; ready: boolean }) {
  const { id, ready } = props;
  const [main, other] = ready ? ['3d', 'edit'] : ['edit', '3d'];
  return (
    <li className="flex items-center hover:bg-stone-50">
      <Link href={`/plans/${id}/${main}`} className="block flex-1 px-3 py-2">
        <span className="block font-medium">{props.name}</span>
        <span className="block text-xs text-stone-500">{props.detail}</span>
      </Link>
      {ready && (
        <Link href={`/plans/${id}/${other}`} className="px-3 py-2 text-xs text-stone-500 underline">
          Edit
        </Link>
      )}
    </li>
  );
}

/** For admins: the internal page to rate layouts (PLAN.md M7). */
function RateLink() {
  const admin = useAccount((s) => s.me?.admin);
  if (!admin) return null;
  return (
    <Link href="/admin/rate" className="text-xs text-stone-500 underline">
      Rate layouts
    </Link>
  );
}
