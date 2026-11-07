import { bounds, floorPolygon } from '@roomie/geometry';
import { type Category, type Floorplan, type Product, ROOM_CATEGORIES, type Room } from '@roomie/schema';
import { clsx } from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { fetchProducts } from '../../api';
import { groupFamilies, matchesFilter, optionChoices, pickVariant } from '../../catalog';
import { CATEGORIES, formatDollars, formatLength } from '../../format';
import { useFurnish } from '../../stores/furnish';
import { useProducts } from '../../stores/products';
import { useWorkspace } from '../../stores/workspace';
import { Notice, Price, Sheet } from '../kit';

type Props = { plan: Floorplan; roomId: string | undefined; imperial: boolean };

/** The last category loaded; it's stale while another one loads. */
type Loaded = { category: Category; products: Product[]; failed?: boolean };

/** Adding furniture to the room in view (§4.6): what suits the room, what fits it. */
export function AddSheet({ plan, roomId, imperial }: Props) {
  const open = useWorkspace((s) => s.sheet === 'add');
  const set = useWorkspace((s) => s.set);
  const room = plan.rooms.find((r) => r.id === roomId);
  const close = () => {
    set({ sheet: undefined });
    useFurnish.getState().arm(undefined);
  };
  return (
    <Sheet
      open={open && room !== undefined}
      onOpenChange={(o) => !o && close()}
      title={room ? `Add to the ${room.name}` : 'Add furniture'}
      description="Pick a piece, then click the floor where it goes. R turns it, Esc stops."
    >
      {room && <Catalog key={room.id} plan={plan} room={room} imperial={imperial} />}
    </Sheet>
  );
}

function Catalog({ plan, room, imperial }: { plan: Floorplan; room: Room; imperial: boolean }) {
  const categories = ROOM_CATEGORIES[room.roomType] ?? [];
  const [category, setCategory] = useState<Category>(categories[0] ?? 'sofa');
  const [maxPrice, setMaxPrice] = useState('');
  const [fits, setFits] = useState(true);
  const [loaded, setLoaded] = useState<Loaded>();
  const armed = useFurnish((s) => s.armed);
  const arm = useFurnish((s) => s.arm);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchProducts(category, ctrl.signal)
      .then((products) => {
        useProducts.getState().add(products);
        setLoaded({ category, products });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLoaded({ category, products: [], failed: true });
      });
    return () => ctrl.abort();
  }, [category]);

  const current = loaded?.category === category ? loaded : undefined;
  const size = useMemo(() => {
    const { min, max } = bounds(floorPolygon(room.boundary, plan.walls));
    return { w: max.x - min.x, d: max.y - min.y };
  }, [plan.walls, room.boundary]);
  const typed = Number(maxPrice.replace(/[^\d.]/g, ''));
  const filter = {
    maxPrice: typed > 0 ? typed : undefined,
    maxWidth: undefined,
    maxDepth: undefined,
    room: fits ? size : undefined,
  };
  const families = groupFamilies((current?.products ?? []).filter((p) => matchesFilter(p, filter)));
  const picked = current?.products.find((p) => p.articleNo === armed?.articleNo);
  const family = families.find((f) => f.id === picked?.familyId);

  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label="What to add" className="flex flex-wrap gap-x-1 border-b border-line px-4 pt-3">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={c === category}
            onClick={() => setCategory(c)}
            className={clsx(
              'border-b-2 px-2 py-2 text-[15px]',
              c === category ? 'border-accent font-semibold' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {CATEGORIES[c]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-3 text-[15px]">
        <label className="flex items-center gap-2">
          <span className="text-ink-muted">Up to</span>
          <span className="font-mono">$</span>
          <input
            inputMode="numeric"
            value={maxPrice}
            placeholder="any"
            onChange={(e) => setMaxPrice(e.target.value)}
            className="w-24 rounded-control border border-line-strong px-2 py-1.5 font-mono"
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={fits} onChange={(e) => setFits(e.target.checked)} />
          Fits in this room
        </label>
      </div>

      {current?.failed && (
        <Notice tone="danger" className="m-5">
          We couldn&apos;t load {CATEGORIES[category].toLowerCase()}. Try again in a moment.
        </Notice>
      )}
      {!current && (
        <p aria-live="polite" className="m-0 p-5 text-ink-muted">
          Loading {CATEGORIES[category].toLowerCase()}…
        </p>
      )}
      {current && !current.failed && families.length === 0 && (
        <p className="m-0 p-5 text-ink-muted">Nothing matches: raise the price, or turn off &ldquo;Fits in this room&rdquo;.</p>
      )}

      {picked && family && (
        <section className="flex flex-col gap-2 border-b-2 border-rule bg-canvas p-5">
          <p className="m-0 font-semibold">
            {family.name} · <Price>{formatDollars(picked.priceCad)}</Price>
          </p>
          {optionChoices(family.variants).map(({ name, values }) => {
            const value = picked.options.find((o) => o.name === name)?.value ?? '';
            return (
              <label key={name} className="flex items-center gap-2 text-[15px]">
                <span className="w-24 shrink-0 text-ink-muted">{name}</span>
                <select
                  value={value}
                  onChange={(e) => {
                    const next = pickVariant(family.variants, picked, name, e.target.value);
                    if (next) arm(next.articleNo);
                  }}
                  className="min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-2 py-1.5"
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
          <p className="m-0 text-[15px] font-medium text-accent-ink">
            Now click the floor of the {room.name} where it goes.
          </p>
        </section>
      )}

      <ul className="m-0 list-none p-0">
        {families.map((f) => {
          const v = f.variants[0]!;
          const on = f.id === family?.id;
          return (
            <li key={f.id} className="border-b border-line">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => arm(on ? undefined : v.articleNo)}
                className={clsx('flex w-full gap-3 px-5 py-3 text-left', on ? 'bg-accent-tint' : 'hover:bg-canvas')}
              >
                <span className="flex size-16 shrink-0 items-center justify-center border border-line bg-surface">
                  {v.imageUrl && (
                    <img src={v.imageUrl} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-semibold">{f.name}</span>
                  <span className="font-mono text-sm">
                    {f.variants.length > 1 ? 'from ' : ''}
                    {formatDollars(v.priceCad)} · {formatLength(v.dims.w, imperial)} ×{' '}
                    {formatLength(v.dims.d, imperial)}
                  </span>
                  {f.variants.length > 1 && (
                    <span className="text-sm text-ink-muted">{f.variants.length} colours and sizes</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
