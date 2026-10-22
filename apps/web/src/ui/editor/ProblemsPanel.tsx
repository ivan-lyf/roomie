import { validateFloorplan } from '@roomie/geometry';
import type { Floorplan } from '@roomie/schema';
import { useMemo } from 'react';
import { useEditor } from '../../stores/editor';

/** What still has to be fixed before the plan is ready; click one to select what it's about. */
export function ProblemsPanel({ plan }: { plan: Floorplan }) {
  const select = useEditor((s) => s.select);
  const problems = useMemo(() => validateFloorplan(plan), [plan]);
  if (problems.length === 0) {
    return <p className="text-xs text-green-700">No problems: the plan is ready for 3D.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {problems.map((p, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => select(p.ids)}
            className="w-full rounded px-2 py-1 text-left text-xs text-red-800 hover:bg-red-50"
          >
            {p.message}
          </button>
        </li>
      ))}
    </ul>
  );
}
