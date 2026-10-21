import type { Dims, Product } from '@roomie/schema';
import { type Size, sizeError } from '../scene/size';

type Props = {
  products: Product[];
  selected: Product | undefined;
  measured: Size | undefined;
  error: string | undefined;
  onSelect: (articleNo: string) => void;
};

/** A model within this many meters of its listed dims counts as true to size. */
const TOLERANCE_M = 0.01;

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const meters = (values: number[]) => `${values.map((v) => v.toFixed(2)).join(' × ')} m`;
const listed = (dims: Dims) => meters([dims.w, dims.h, dims.d]);

export function ProductPanel({ products, selected, measured, error, onSelect }: Props) {
  return (
    <aside className="absolute top-4 left-4 w-80 space-y-3 rounded-xl bg-white/90 p-4 text-sm text-stone-800 shadow-lg backdrop-blur">
      <h1 className="text-base font-semibold">Roomie · sofa spike</h1>

      {error && <p className="text-red-700">{error}</p>}

      {!error && products.length === 0 && (
        <p>
          No sofas yet. Run <code>pnpm scrape --category fu003 --models</code>, then{' '}
          <code>pnpm catalog:import</code> and <code>pnpm models:process</code>.
        </p>
      )}

      {products.length > 0 && (
        <select
          className="w-full rounded-md border border-stone-300 bg-white p-1.5"
          value={selected?.articleNo ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {products.map((p) => (
            <option key={p.articleNo} value={p.articleNo}>
              {p.name}
              {p.modelUrl ? '' : ' (no model)'}
            </option>
          ))}
        </select>
      )}

      {selected && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-stone-500">Price</dt>
          <dd>{cad.format(selected.priceCad)}</dd>
          <dt className="text-stone-500">Listed</dt>
          <dd>{listed(selected.dims)}</dd>
          <dt className="text-stone-500">Model</dt>
          <dd>
            <ModelSize product={selected} measured={measured} />
          </dd>
          <dt className="text-stone-500">Link</dt>
          <dd>
            <a className="underline" href={selected.url} target="_blank" rel="noreferrer">
              {selected.articleNo} on IKEA.ca
            </a>
          </dd>
        </dl>
      )}

      <p className="text-xs text-stone-500">
        Sizes are w × h × d. Grid cells are 10 cm, sections 1 m. The red outline is the listed size.
      </p>
    </aside>
  );
}

function ModelSize({ product, measured }: { product: Product; measured: Size | undefined }) {
  if (!product.modelUrl) return <span>None, showing a box</span>;
  if (!measured) return <span>Loading…</span>;
  const error = sizeError(measured, product.dims);
  return (
    <span>
      {meters(measured)}{' '}
      {error <= TOLERANCE_M ? (
        <span className="text-emerald-700">✓ true to size</span>
      ) : (
        <span className="text-red-700">off by {Math.round(error * 100)} cm</span>
      )}
    </span>
  );
}
