import { useEffect } from 'react';
import type { Highlight } from './PlanSheet';

/** Shows on the plan what the question on screen is about, for as long as it's up. */
export function useHighlight(set: (h: Highlight) => void, highlight: Highlight) {
  const key = JSON.stringify(highlight);
  useEffect(() => set(JSON.parse(key) as Highlight), [key, set]);
}
