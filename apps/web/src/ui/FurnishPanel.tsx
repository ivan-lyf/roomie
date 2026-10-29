import { bounds, floorPolygon } from '@roomie/geometry';
import {
  Category,
  FURNISHABLE,
  type Floorplan,
  type Product,
  type Room,
  type RoomType,
} from '@roomie/schema';
import { useEffect, useMemo, useState } from 'react';
import { fetchProducts } from '../api';
import { groupFamilies, matchesFilter, optionChoices, pickVariant } from '../catalog';
import {
  CATEGORIES,
  formatLength,
  formatPrice,
  isImperial,
  parseLength,
  ROOM_TYPES,
} from '../format';
import { useFurnish } from '../stores/furnish';
import { useProducts } from '../stores/products';

/** The category a room's furnishing starts on. */
const FIRST_CATEGORY: Partial<Record<RoomType, Category>> = {
  living_room: 'sofa',
  bedroom: 'bed',
  studio: 'sofa',
  dining_area: 'dining_table',
  den_office: 'desk',
};

const furnishable = (room: Room) => room.furnishable && FURNISHABLE.has(room.roomType);

/** The size of a room's floor inside its walls, width by depth on the plan. */
function floorSize(plan: Floorplan, room: Room): { w: number; d: number } {
  const { min, max } = bounds(floorPolygon(room.boundary, plan.walls));
  return { w: max.x - min.x, d: max.y - min.y };
}

/** The last category loaded; it's stale while another one loads. */
type Loaded = { category: Category; products: Product[]; error?: string };

type Props = {
  plan: Floorplan;
  roomId: string | undefined;
  onRoom: (roomId: string) => void;
};

/** Picks products to place in a room, from the catalog filtered by price and size. */
export function FurnishPanel({ plan, roomId, onRoom }: Props) {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || !furnishable(room)) {
    const rooms = plan.rooms.filter(furnishable);
    return (
      <section className="space-y-2">
        <p>{room ? `The ${room.name} doesn't get furniture. ` : ''}Pick a room to furnish:</p>
        {rooms.length === 0 && (
          <p className="text-stone-500">
            No room gets furniture: make one a living room, bedroom, studio, dining area or den.
          </p>
        )}
        <ul className="flex flex-wrap gap-1">
          {rooms.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="rounded-full bg-stone-100 px-2.5 py-1 text-xs hover:bg-stone-200"
                onClick={() => onRoom(r.id)}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return <Catalog key={room.id} plan={plan} room={room} />;
}

function Catalog({ plan, room }: { plan: Floorplan; room: Room }) {
  const imperial = isImperial(plan.scale?.sourceUnit);
  const [category, setCategory] = useState<Category>(FIRST_CATEGORY[room.roomType] ?? 'sofa');
  const [maxPrice, setMaxPrice] = useState('');
  const [maxWidth, setMaxWidth] = useState('');
  const [maxDepth, setMaxDepth] = useState('');
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
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoaded({ category, products: [], error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [category]);

  const current = loaded?.category === category ? loaded : undefined;
  const size = useMemo(() => floorSize(plan, room), [plan, room]);
  const filter = {
    maxPrice: Number(maxPrice) > 0 ? Number(maxPrice) : undefined,
    maxWidth: parseLength(maxWidth, imperial),
    maxDepth: parseLength(maxDepth, imperial),
    room: fits ? size : undefined,
  };
  const shown = (current?.products ?? []).filter((p) => matchesFilter(p, filter));
  const families = groupFamilies(shown);
  const picked = shown.find((p) => p.articleNo === armed?.articleNo);
  const family = families.find((f) => f.id === picked?.familyId);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <p>
        Furnishing the <span className="font-medium">{room.name}</span> (
        {ROOM_TYPES[room.roomType].toLowerCase()}, {formatLength(size.w, imperial)} ×{' '}
        {formatLength(size.d, imperial)} inside).
      </p>

      <nav className="flex flex-wrap gap-1" aria-label="Categories">
        {Category.options.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              c === category ? 'bg-stone-800 text-white' : 'bg-stone-100 hover:bg-stone-200'
            }`}
          >
            {CATEGORIES[c]}
          </button>
        ))}
      </nav>

      <fieldset className="grid grid-cols-3 gap-2 text-xs">
        <Limit label="Up to $" value={maxPrice} onChange={setMaxPrice} placeholder="any" />
        <Limit label="Wide up to" value={maxWidth} onChange={setMaxWidth} placeholder="any" />
        <Limit label="Deep up to" value={maxDepth} onChange={setMaxDepth} placeholder="any" />
        <label className="col-span-3 flex items-center gap-2">
          <input type="checkbox" checked={fits} onChange={(e) => setFits(e.target.checked)} />
          Only what fits in the {room.name}
        </label>
      </fieldset>

      {current?.error && <p className="text-red-700">{current.error}</p>}
      {!current && <p className="text-stone-500">Loading {CATEGORIES[category].toLowerCase()}…</p>}
      {current && !current.error && families.length === 0 && (
        <p className="text-stone-500">Nothing matches: loosen the limits above.</p>
      )}

      <ul className="min-h-24 flex-1 divide-y divide-stone-200 overflow-y-auto rounded-md border border-stone-200">
        {families.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => arm(f.id === family?.id ? undefined : f.variants[0]!.articleNo)}
              className={`w-full px-3 py-2 text-left ${f.id === family?.id ? 'bg-stone-100' : 'hover:bg-stone-50'}`}
            >
              <span className="block font-medium">{f.name}</span>
              <span className="block text-xs text-stone-500">
                from {formatPrice(f.variants[0]!.priceCad)} ·{' '}
                {formatLength(f.variants[0]!.dims.w, imperial)} ×{' '}
                {formatLength(f.variants[0]!.dims.d, imperial)}
                {f.variants.length > 1 && ` · ${f.variants.length} variants`}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {picked && family && (
        <section className="space-y-2 rounded-md bg-stone-50 p-2">
          {optionChoices(family.variants).map(({ name, values }) => {
            const value = picked.options.find((o) => o.name === name)?.value ?? '';
            return (
              <label key={name} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-stone-500">{name}</span>
                <select
                  className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white p-1"
                  value={value}
                  onChange={(e) => {
                    const next = pickVariant(family.variants, picked, name, e.target.value);
                    if (next) arm(next.articleNo);
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
          <p>
            {formatPrice(picked.priceCad)} · {formatLength(picked.dims.w, imperial)} wide ×{' '}
            {formatLength(picked.dims.d, imperial)} deep
          </p>
          <p className="text-xs text-stone-500">
            Click the floor of the {room.name} to place it. R turns it, Esc stops.
          </p>
        </section>
      )}
    </section>
  );
}

function Limit(props: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-stone-500">{props.label}</span>
      <input
        className="min-w-0 rounded-md border border-stone-300 p-1"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}
