import { Category, type Dims, type Product } from '@roomie/schema';
import { type Family, optionChoices, pickVariant } from '../catalog';
import { type Size, sizeError } from '../scene/size';

type Props = {
  category: Category;
  families: Family[];
  selected: Product | undefined;
  measured: Size | undefined;
  loading: boolean;
  error: string | undefined;
  onCategory: (category: Category) => void;
  onSelect: (articleNo: string) => void;
};

const LABELS: Record<Category, string> = {
  bed: 'Beds',
  sofa: 'Sofas',
  armchair: 'Armchairs',
  coffee_table: 'Coffee tables',
  dining_table: 'Dining tables',
  dining_chair: 'Dining chairs',
  desk: 'Desks',
  desk_chair: 'Desk chairs',
  shelving: 'Shelving',
  wardrobe: 'Wardrobes',
  dresser: 'Dressers',
  nightstand: 'Nightstands',
  tv_unit: 'TV units',
  rug: 'Rugs',
  floor_lamp: 'Floor lamps',
};

/** A model within this many meters of its listed dims counts as true to size. */
const TOLERANCE_M = 0.01;

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const meters = (values: number[]) => `${values.map((v) => v.toFixed(2)).join(' × ')} m`;
const listed = (dims: Dims) => meters([dims.w, dims.h, dims.d]);
const footprint = (dims: Dims) => `${Math.round(dims.w * 100)}×${Math.round(dims.d * 100)} cm`;

export function CatalogPanel(props: Props) {
  const { category, families, selected, loading, error, onCategory, onSelect } = props;
  const family = families.find((f) => f.id === selected?.familyId);
  return (
    <aside className="absolute top-4 bottom-4 left-4 flex w-96 flex-col gap-3 rounded-xl bg-white/90 p-4 text-sm text-stone-800 shadow-lg backdrop-blur">
      <h1 className="text-base font-semibold">Roomie · catalog</h1>

      <nav className="flex flex-wrap gap-1" aria-label="Categories">
        {Category.options.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onCategory(c)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              c === category ? 'bg-stone-800 text-white' : 'bg-stone-100 hover:bg-stone-200'
            }`}
          >
            {LABELS[c]}
          </button>
        ))}
      </nav>

      {error && <p className="text-red-700">{error}</p>}
      {!error && !loading && families.length === 0 && (
        <p>
          No products yet. Run <code>pnpm catalog:import</code>, then{' '}
          <code>pnpm models:download</code> and <code>pnpm models:process</code>.
        </p>
      )}

      <ul className="min-h-0 flex-1 divide-y divide-stone-200 overflow-y-auto rounded-md border border-stone-200">
        {families.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onSelect(f.variants[0]!.articleNo)}
              className={`w-full px-3 py-2 text-left ${f.id === family?.id ? 'bg-stone-100' : 'hover:bg-stone-50'}`}
            >
              <span className="block font-medium">{f.name}</span>
              <span className="block text-xs text-stone-500">
                {f.variants.length} variant{f.variants.length === 1 ? '' : 's'} · from{' '}
                {cad.format(f.variants[0]!.priceCad)} · {footprint(f.variants[0]!.dims)}
                {f.variants.some((v) => v.modelSource === 'ikea' && v.modelUrl) && ' · IKEA model'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected && family && (
        <section className="space-y-2">
          {optionChoices(family.variants).map(({ name, values }) => {
            const current = selected.options.find((o) => o.name === name)?.value ?? '';
            return (
              <label key={name} className="flex items-center gap-2">
                <span className="w-32 shrink-0 text-stone-500">{name}</span>
                <select
                  className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white p-1"
                  value={current}
                  onChange={(e) => {
                    const next = pickVariant(family.variants, selected, name, e.target.value);
                    if (next) onSelect(next.articleNo);
                  }}
                >
                  {values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <Details product={selected} measured={props.measured} />
        </section>
      )}

      <p className="text-xs text-stone-500">
        Sizes are w × h × d. Grid cells are 10 cm, sections 1 m. The red outline is the listed size.
      </p>
    </aside>
  );
}

function Details({ product, measured }: { product: Product; measured: Size | undefined }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-stone-500">Price</dt>
      <dd>{cad.format(product.priceCad)}</dd>
      <dt className="text-stone-500">Listed</dt>
      <dd>{listed(product.dims)}</dd>
      <dt className="text-stone-500">Model</dt>
      <dd>
        <ModelSize product={product} measured={measured} />
      </dd>
      <dt className="text-stone-500">Link</dt>
      <dd>
        <a className="underline" href={product.url} target="_blank" rel="noreferrer">
          {product.articleNo} on IKEA.ca
        </a>
      </dd>
    </dl>
  );
}

function ModelSize({ product, measured }: { product: Product; measured: Size | undefined }) {
  if (!product.modelUrl) return <span>None yet, showing a box</span>;
  const source = product.modelSource === 'ikea' ? 'IKEA model' : 'Stand-in';
  if (!measured) return <span>{source}, loading…</span>;
  const error = sizeError(measured, product.dims, product.shape);
  return (
    <span>
      {source}, {meters(measured)}{' '}
      {error <= TOLERANCE_M ? (
        <span className="text-emerald-700">✓ true to size</span>
      ) : (
        <span className="text-red-700">off by {Math.round(error * 100)} cm</span>
      )}
    </span>
  );
}
