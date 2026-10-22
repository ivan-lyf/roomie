import type { FloorplanStatus, FloorplanSummary } from '@roomie/schema';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { fetchFloorplans, uploadFloorplan } from '../api';
import { ACCEPTED, preparePlan } from '../upload';

const STATUS: Record<FloorplanStatus, string> = {
  uploaded: 'Not traced yet',
  needs_calibration: 'Needs its scale',
  ready: 'Ready',
};

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

type Upload =
  | { state: 'idle' }
  | { state: 'busy'; step: string }
  | { state: 'failed'; error: string };

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
      navigate(`/plans/${plan.id}/3d`);
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
            <span className="text-xs text-stone-500">PNG, JPEG, WebP or PDF (its first page)</span>
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
          <PlanLink id="demo" name="Demo one-bedroom" detail="A sample plan to try things on" />
          {plans?.map((p) => (
            <PlanLink
              key={p.id}
              id={p.id}
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

function PlanLink({ id, name, detail }: { id: string; name: string; detail: string }) {
  return (
    <li>
      <Link href={`/plans/${id}/3d`} className="block px-3 py-2 hover:bg-stone-50">
        <span className="block font-medium">{name}</span>
        <span className="block text-xs text-stone-500">{detail}</span>
      </Link>
    </li>
  );
}
