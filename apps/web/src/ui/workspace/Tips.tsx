import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../kit';

// At most three one-time tips (§5), one at a time, remembered in this browser. Storage can be
// missing or refuse, so the tips then simply show again next time.

const TIPS = [
  'Click any piece to see it, swap it, or remove it.',
  "Drag to move things. We'll stop you if it blocks a door or a path.",
  'Everything you see is in your shopping list.',
];

const KEY = 'roomie.tips';

function seen(): number {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** The next tip not yet dismissed, over a corner of the view; it never blocks it. */
export function Tips({ show }: { show: boolean }) {
  const [at, setAt] = useState(seen);
  if (!show || at >= TIPS.length) return null;
  const next = () => {
    setAt(at + 1);
    try {
      localStorage.setItem(KEY, String(at + 1));
    } catch {
      // Not remembered: it shows again next time.
    }
  };
  return (
    <aside
      aria-label="Tip"
      className="pointer-events-auto flex w-72 animate-panel-in flex-col gap-3 bg-surface p-4 shadow-panel"
    >
      <div className="flex items-start gap-3">
        <span className="font-mono text-xs text-accent">TIP {at + 1}/3</span>
        <button
          type="button"
          aria-label="Hide tips"
          onClick={() => {
            setAt(TIPS.length);
            try {
              localStorage.setItem(KEY, String(TIPS.length));
            } catch {
              // Not remembered.
            }
          }}
          className="ml-auto text-ink-muted hover:text-ink"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <p className="m-0 text-[15px] leading-normal">{TIPS[at]}</p>
      <Button size="sm" variant="secondary" className="self-start" onClick={next}>
        Got it
      </Button>
    </aside>
  );
}
