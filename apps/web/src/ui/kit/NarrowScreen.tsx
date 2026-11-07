import { type ReactNode, useSyncExternalStore } from 'react';

const query = '(min-width: 1024px)';

function subscribe(onChange: () => void) {
  const list = window.matchMedia(query);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

/** Below 1024 px, one friendly screen instead of a squeezed workspace (§6). */
export function WideEnough({ children }: { children: ReactNode }) {
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
  if (wide) return children;
  return (
    <main className="flex min-h-full flex-col justify-center gap-4 bg-grid p-6">
      <p className="text-xl font-bold tracking-tight">ROOMIE</p>
      <h1 className="m-0 text-3xl leading-tight font-bold tracking-tight">
        Roomie works best on a laptop or desktop.
      </h1>
      <p className="m-0 text-lg">Open this link there to see your home.</p>
    </main>
  );
}
