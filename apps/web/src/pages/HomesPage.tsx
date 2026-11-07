import type { FloorplanSummary } from '@roomie/schema';
import { clsx } from 'clsx';
import { Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { fetchFloorplans, floorplanImageUrl, uploadFloorplan } from '../api';
import { homeStatus } from '../copy';
import { formatDollars } from '../format';
import { browserHomes, rememberHome } from '../homes';
import { useAccount } from '../stores/account';
import { AccountMenu } from '../ui/account/AccountMenu';
import { SampleLink } from '../ui/SampleLink';
import { Button, Header, Notice, Price } from '../ui/kit';
import { ACCEPTED, preparePlan } from '../upload';

type Upload =
  | { state: 'idle' }
  | { state: 'busy'; step: string }
  | { state: 'failed'; error: string; retry?: File };

const edited = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' });

/** Where a home opens: the step it was left at (§4.1). */
export function resumePath(home: FloorplanSummary): string {
  if (home.itemCount > 0) return `/plans/${home.id}`;
  if (home.status === 'ready') return `/plans/${home.id}/preferences`;
  return `/plans/${home.id}/check`;
}

/** Start a home from a floor plan, or open one (prototype 1 and 9). */
export function HomesPage() {
  const [, navigate] = useLocation();
  const email = useAccount((s) => s.email);
  const [homes, setHomes] = useState<FloorplanSummary[]>();
  const [listFailed, setListFailed] = useState(false);
  const [upload, setUpload] = useState<Upload>({ state: 'idle' });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback((signal?: AbortSignal) => {
    fetchFloorplans(browserHomes(), signal)
      .then((list) => {
        setHomes(list);
        setListFailed(false);
      })
      .catch(() => {
        if (!signal?.aborted) setListFailed(true);
      });
  }, []);

  // Again once sign-in is known: the account's own homes join this browser's.
  useEffect(() => {
    if (email === undefined) return;
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [email, load]);

  const send = async (file: File | undefined) => {
    if (!file || upload.state === 'busy') return;
    let step = 'prepare';
    try {
      setUpload({ state: 'busy', step: 'Getting your plan ready…' });
      const { image, name } = await preparePlan(file);
      step = 'upload';
      setUpload({ state: 'busy', step: 'Uploading…' });
      const plan = await uploadFloorplan(image, name);
      rememberHome(plan.id);
      navigate(`/plans/${plan.id}/check`);
    } catch (e) {
      setUpload(
        step === 'upload'
          ? { state: 'failed', error: "The upload didn't finish; check your connection and", retry: file }
          : { state: 'failed', error: prepareError(file, e) },
      );
    }
  };

  return (
    <div className="min-h-full bg-grid">
      <Header>
        <span className="ml-auto">
          <AccountMenu />
        </span>
      </Header>
      <main className="mx-auto flex max-w-[1040px] flex-col gap-7 px-8 pt-14 pb-16">
        <h1 className="m-0 max-w-[720px] text-[32px] leading-tight font-bold tracking-tight">
          Upload your floor plan. See your home furnished with IKEA pieces that actually fit, with
          prices.
        </h1>

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
          aria-describedby="drop-hint"
          className={clsx(
            'flex flex-col items-center gap-3 rounded-control border-2 border-dashed px-6 py-12 text-center',
            dragging ? 'border-accent bg-accent-tint' : 'border-line-strong bg-surface hover:border-ink',
          )}
        >
          {upload.state === 'busy' ? (
            <span aria-live="polite" className="text-xl font-semibold">
              {upload.step}
            </span>
          ) : (
            <>
              <Upload size={40} className="text-accent" aria-hidden />
              <span className="text-xl font-semibold">Drop your floor plan here</span>
              <span className="inline-block rounded-control bg-accent px-5 py-3 font-semibold text-white">
                Choose a file
              </span>
              <span id="drop-hint" className="text-ink-muted">
                A photo, screenshot or PDF of the listing&apos;s plan
              </span>
            </>
          )}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          tabIndex={-1}
          onChange={(e) => void send(e.target.files?.[0])}
        />
        {upload.state === 'failed' && (
          <Notice tone="danger">
            <span role="alert">
              {upload.error}
              {upload.retry && (
                <>
                  {' '}
                  <Button variant="link" onClick={() => void send(upload.retry)}>
                    try again
                  </Button>
                  .
                </>
              )}
            </span>
          </Notice>
        )}

        <p className="m-0 text-ink-muted">
          No plan handy?{' '}
          <SampleLink className="font-semibold" />
        </p>

        <section aria-labelledby="your-homes" className="mt-4 flex flex-col gap-4">
          {(listFailed || (homes && homes.length > 0)) && (
            <div className="flex flex-col gap-1">
              <h2 id="your-homes" className="m-0 text-2xl font-semibold">
                Your homes
              </h2>
              {email && (
                <p className="m-0 text-ink-muted">Saved to your account. Open them on any device.</p>
              )}
            </div>
          )}
          {listFailed && (
            <Notice tone="danger">
              We couldn&apos;t load your homes.{' '}
              <Button variant="link" onClick={() => load()}>
                Try again
              </Button>
            </Notice>
          )}
          {homes && homes.length > 0 && (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5 p-0">
              {homes.map((h) => (
                <HomeCard key={h.id} home={h} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function HomeCard({ home }: { home: FloorplanSummary }) {
  const status = homeStatus(home.status, home.itemCount);
  const tone =
    home.itemCount > 0 ? 'text-ok' : home.status === 'ready' ? 'text-ink-muted' : 'text-warn';
  return (
    <li>
      <Link
        href={resumePath(home)}
        className="flex h-full flex-col border border-line bg-surface text-ink no-underline hover:border-ink"
      >
        <div className="flex h-36 items-center justify-center overflow-hidden border-b border-line bg-surface p-2">
          {home.hasImage ? (
            <img
              src={floorplanImageUrl(home.id)}
              alt=""
              loading="lazy"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="font-mono text-xs text-ink-muted">TRACED BY HAND</span>
          )}
        </div>
        <div className="flex flex-col gap-1 px-4 py-3.5">
          <span className="font-semibold">{home.name}</span>
          <span className={clsx('text-sm font-medium', tone)}>
            {status}
            {home.itemCount > 0 && (
              <>
                {' · '}
                <Price>{formatDollars(home.totalCad)}</Price>
              </>
            )}
          </span>
          <span className="text-[13px] text-ink-muted">Edited {edited.format(home.updatedAt)}</span>
        </div>
      </Link>
    </li>
  );
}

/** Why a file couldn't be made ready to upload, in words (§4.1). */
function prepareError(file: File, e: unknown): string {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const message = e instanceof Error ? e.message : '';
  if (isPdf && /page/i.test(message)) return 'That PDF has no pages.';
  if (isPdf) return "We couldn't open that PDF. Try a screenshot of the plan instead.";
  return "That file isn't an image or PDF.";
}
