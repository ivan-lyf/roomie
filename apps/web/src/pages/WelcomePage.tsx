import { Redirect, useLocation } from 'wouter';
import { hasHomes } from '../homes';
import { AccountMenu } from '../ui/account/AccountMenu';
import { SampleLink } from '../ui/SampleLink';
import { useSignIn } from '../ui/account/signIn';
import { Button, ButtonLink } from '../ui/kit';

const REASONS = [
  {
    title: 'One click to a furnished home',
    body: 'Pick a budget and a style. Every living room, bedroom and den gets laid out for you.',
  },
  {
    title: 'No tape measure',
    body: 'Room sizes come from your plan, so you never guess whether the sofa fits the wall.',
  },
  {
    title: 'Doors still open',
    body: "Paths stay clear, windows stay free. If something won't fit, you're told why.",
  },
  {
    title: 'No store trips to picture it',
    body: 'See your actual rooms in 3D with the real products in them, before you shop.',
  },
  {
    title: 'The shopping list, written',
    body: 'Every piece, quantity and price, grouped by room, with a link to each one.',
  },
];

const STEPS = [
  {
    label: 'Step 1 · about 2 min',
    title: 'Upload the plan',
    body: 'A photo, screenshot or PDF. Confirm the size and the rooms in a few questions.',
  },
  {
    label: 'Step 2 · one click',
    title: 'Set a budget and style',
    body: 'Everything is filled in already. Click "Furnish my home".',
  },
  {
    label: 'Step 3 · under 3 min',
    title: 'Look, change, buy',
    body: 'Walk through it in 3D, swap pieces, then take the shopping list.',
  },
];

/** The first page a visitor sees (prototype 0); someone with homes goes straight to them. */
export function WelcomePage() {
  const [, navigate] = useLocation();
  const openSignIn = useSignIn((s) => s.open);
  if (hasHomes()) return <Redirect to="/homes" replace />;
  return (
    <div className="min-h-full bg-grid text-[17px]">
      <header className="mx-auto flex max-w-[1184px] flex-wrap items-center gap-8 border-b-2 border-rule px-8 py-5">
        <span className="text-[22px] font-bold tracking-tight">ROOMIE</span>
        <span className="font-mono text-[13px] text-ink-muted">SHEET 01 / FOR RENTERS AND BUYERS</span>
        <span className="ml-auto">
          <AccountMenu />
        </span>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1184px] grid-cols-12 gap-x-6 gap-y-10 px-8 pt-18 pb-14">
          <div className="col-span-6 flex flex-col gap-7">
            <h1 className="m-0 text-[64px] leading-[0.98] font-bold tracking-[-0.035em]">
              Measure nothing. See it furnished.
            </h1>
            <p className="m-0 max-w-[480px] text-xl leading-normal">
              Give Roomie the floor plan from the listing. It draws your home in 3D, fits real IKEA
              pieces into every room, and lists what to buy.
            </p>
            <div className="flex flex-wrap items-center gap-7">
              <ButtonLink href="/homes" size="lg">
                Upload your floor plan
              </ButtonLink>
              <SampleLink />
            </div>
          </div>
          <PlanFigure />
        </section>

        <section className="mx-auto max-w-[1184px] px-8 pb-18">
          <h2 className="m-0 mb-2 font-mono text-sm font-medium tracking-wider text-ink-muted">
            WHAT IT SAVES YOU
          </h2>
          <ol className="m-0 list-none border-t-2 border-rule p-0">
            {REASONS.map((r, i) => (
              <li
                key={r.title}
                className="grid grid-cols-[72px_minmax(0,5fr)_minmax(0,6fr)] items-baseline gap-x-6 border-b border-rule py-6"
              >
                <span className="font-mono text-sm text-accent">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="m-0 text-[28px] font-bold tracking-tight">{r.title}</h3>
                <p className="m-0 text-lg leading-normal text-ink-muted">{r.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-ink text-canvas">
          <div className="mx-auto grid max-w-[1184px] grid-cols-3 gap-8 px-8 py-16">
            {STEPS.map((s) => (
              <div key={s.title} className="flex flex-col gap-2.5 border-t border-canvas pt-4">
                <span className="font-mono text-[13px] text-accent-tint uppercase">{s.label}</span>
                <h3 className="m-0 text-2xl font-bold">{s.title}</h3>
                <p className="m-0 leading-normal text-[#d4d4cf]">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto flex max-w-[1184px] flex-wrap items-baseline justify-between gap-6 border-b-2 border-rule px-8 py-14">
          <p className="m-0 text-[28px] font-bold tracking-tight">Already have homes saved?</p>
          <div className="flex items-center gap-7">
            <Button
              variant="secondary"
              onClick={() => openSignIn({ reason: 'choice', then: () => navigate('/homes') })}
            >
              Sign in
            </Button>
            <ButtonLink href="/homes" variant="link">
              Start without an account →
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1184px] flex-wrap justify-between gap-4 px-8 pt-5 pb-8 font-mono text-[13px] text-ink-muted">
        <span>Not affiliated with IKEA. Prices read from IKEA.ca; check before buying.</span>
        <span>Best on a laptop or desktop</span>
      </footer>
    </div>
  );
}

/** FIG. 1: a living room drawn as a plan, with a sofa, its size and the space to walk. */
function PlanFigure() {
  const mono = 'IBM Plex Mono, monospace';
  return (
    <figure className="col-span-6 m-0">
      <svg viewBox="0 0 520 380" width="100%" role="img" aria-label="Plan drawing of a furnished living room">
        <rect x="40" y="30" width="440" height="300" fill="#ffffff" stroke="#1c1c1a" strokeWidth="8" />
        <line x1="200" y1="330" x2="260" y2="330" stroke="#ffffff" strokeWidth="10" />
        <path d="M200 330 A60 60 0 0 1 260 270" fill="none" stroke="#1c1c1a" strokeWidth="1" />
        <line x1="260" y1="330" x2="260" y2="270" stroke="#1c1c1a" strokeWidth="1.5" />
        <line x1="300" y1="30" x2="420" y2="30" stroke="#1d4ed8" strokeWidth="8" />
        <rect x="90" y="46" width="230" height="82" fill="none" stroke="#1c1c1a" strokeWidth="2" />
        <line x1="90" y1="70" x2="320" y2="70" stroke="#1c1c1a" strokeWidth="1" />
        <rect x="155" y="160" width="100" height="52" fill="none" stroke="#1c1c1a" strokeWidth="2" />
        <rect x="80" y="140" width="250" height="100" fill="none" stroke="#1c1c1a" strokeWidth="1" strokeDasharray="4 4" />
        <rect x="135" y="290" width="140" height="28" fill="none" stroke="#1c1c1a" strokeWidth="2" />
        <line x1="90" y1="10" x2="320" y2="10" stroke="#1d4ed8" strokeWidth="1" />
        <line x1="90" y1="4" x2="90" y2="16" stroke="#1d4ed8" strokeWidth="1" />
        <line x1="320" y1="4" x2="320" y2="16" stroke="#1d4ed8" strokeWidth="1" />
        <text x="205" y="22" textAnchor="middle" fontFamily={mono} fontSize="12" fill="#1d4ed8">
          7′ 5″ 3-SEAT SOFA
        </text>
        <line x1="500" y1="30" x2="500" y2="330" stroke="#4a4a45" strokeWidth="1" />
        <line x1="494" y1="30" x2="506" y2="30" stroke="#4a4a45" strokeWidth="1" />
        <line x1="494" y1="330" x2="506" y2="330" stroke="#4a4a45" strokeWidth="1" />
        <text x="512" y="185" fontFamily={mono} fontSize="12" fill="#4a4a45" transform="rotate(90 512 185)">
          12′ 0″
        </text>
        <line x1="40" y1="352" x2="480" y2="352" stroke="#4a4a45" strokeWidth="1" />
        <text x="260" y="370" textAnchor="middle" fontFamily={mono} fontSize="12" fill="#4a4a45">
          14′ 0″ LIVING ROOM
        </text>
        <line x1="340" y1="186" x2="440" y2="186" stroke="#1d4ed8" strokeWidth="1" />
        <text x="390" y="178" textAnchor="middle" fontFamily={mono} fontSize="11" fill="#1d4ed8">
          2′ 6″ TO WALK
        </text>
      </svg>
      <figcaption className="flex justify-between border-t border-rule pt-2.5 font-mono text-[13px] text-ink-muted">
        <span>FIG. 1 · A living room, furnished</span>
        <span>Every size from your plan</span>
      </figcaption>
    </figure>
  );
}
