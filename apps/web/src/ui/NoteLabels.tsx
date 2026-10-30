import type { NoteLabel, NoteReading, Placement, Product, Side } from '@roomie/schema';
import { NoteProblem } from '@roomie/schema';
import { familyName } from '../catalog';
import { FEATURES, NOTE_PROBLEMS } from '../rating';

type Props = {
  reading: NoteReading;
  /** The room's items in each layout. */
  sides: Record<Side, readonly Placement[]>;
  products: ReadonlyMap<string, Product>;
  /** The labels as corrected: saved as they change. */
  onChange: (labels: NoteLabel[]) => void;
};

const select = 'rounded border border-stone-300 bg-white px-1 py-0.5';

/**
 * How the AI read a rating's notes (PLAN.md M7): one line per problem, each part of it a choice
 * the rater can correct, or drop.
 */
export function NoteLabels({ reading, sides, products, onChange }: Props) {
  const nameOf = (id: string | null) => {
    if (!id) return undefined;
    const placement = [...sides.a, ...sides.b].find((p) => p.id === id);
    const product = placement && products.get(placement.articleNo);
    return product ? familyName(product) : id;
  };
  const change = (i: number, edit: Partial<NoteLabel>) =>
    onChange(reading.labels.map((l, j) => (j === i ? { ...l, ...edit } : l)));

  if (reading.labels.length === 0) {
    return <p className="text-stone-500">Your note was read as naming no problem.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-stone-500">
        Your note, as {reading.corrected ? 'you corrected it' : 'the AI read it'}:
      </p>
      <ul className="flex flex-col gap-1">
        {reading.labels.map((label, i) => {
          // Of both: the two layouts' items, once each by id.
          const items =
            label.side === 'both'
              ? [...new Map([...sides.a, ...sides.b].map((p) => [p.id, p])).values()]
              : sides[label.side];
          return (
            <li key={i} className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">
                {label.side === 'both' ? 'Both' : label.side.toUpperCase()}
              </span>
              <select
                aria-label="Which item"
                className={select}
                value={label.items[0] ?? ''}
                onChange={(e) =>
                  change(i, {
                    items: e.target.value ? [e.target.value, ...label.items.slice(1)] : [],
                  })
                }
              >
                <option value="">the room</option>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {nameOf(p.id)} ({p.id})
                  </option>
                ))}
              </select>
              <select
                aria-label="What's wrong"
                className={select}
                value={label.problem}
                onChange={(e) => change(i, { problem: NoteProblem.parse(e.target.value) })}
              >
                {NoteProblem.options.map((p) => (
                  <option key={p} value={p}>
                    {NOTE_PROBLEMS[p]}
                  </option>
                ))}
              </select>
              {label.relativeTo && <span>{nameOf(label.relativeTo)}</span>}
              <span className="text-stone-500">· measured by</span>
              <select
                aria-label="Which feature"
                className={select}
                value={label.feature ?? ''}
                onChange={(e) => change(i, { feature: e.target.value || null })}
              >
                <option value="">nothing the scorer has</option>
                {Object.entries(FEATURES).map(([feature, words]) => (
                  <option key={feature} value={feature}>
                    {words}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-xs text-stone-500 underline"
                onClick={() => onChange(reading.labels.filter((_, j) => j !== i))}
              >
                Drop
              </button>
              {label.rule && <span className="w-full pl-6 text-stone-500">Rule: {label.rule}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
