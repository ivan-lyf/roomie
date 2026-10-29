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
import { familyName, groupFamilies, matchesFilter, optionChoices, pickVariant } from '../catalog';
import {
  CATEGORIES,
  formatLength,
  formatPrice,
  isImperial,
  parseLength,
  ROOM_TYPES,
} from '../format';
import { removeItem, rotateItem, useLayoutProblems, useScores, whyOf } from '../furnishing';
import { redo, undo } from '../stores/floorplan';
import { useFurnish } from '../stores/furnish';
import { useIntents } from '../stores/intents';
import { useProducts } from '../stores/products';
import { AutoFurnish } from './AutoFurnish';

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
  /** Whether the plan is saved on the server, so it can be furnished automatically. */
  saved: boolean;
};

/** Picks products to place in a room, from the catalog filtered by price and size. */
export function FurnishPanel({ plan, roomId, onRoom, saved }: Props) {
  const room = plan.rooms.find((r) => r.id === roomId);
  return (
    <>
      <AutoFurnish plan={plan} saved={saved} />
      {room && furnishable(room) ? (
        <Catalog key={room.id} plan={plan} room={room} />
      ) : (
        <RoomPicker plan={plan} room={room} onRoom={onRoom} />
      )}
    </>
  );
}

/** The rooms to pick from, when the one picked doesn't get furniture. */
function RoomPicker({
  plan,
  room,
  onRoom,
}: {
  plan: Floorplan;
  room: Room | undefined;
  onRoom: (roomId: string) => void;
}) {
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
    <section className="flex flex-col gap-3">
      <p>
        Furnishing the <span className="font-medium">{room.name}</span> (
        {ROOM_TYPES[room.roomType].toLowerCase()}, {formatLength(size.w, imperial)} ×{' '}
        {formatLength(size.d, imperial)} inside).
      </p>

      <RoomItems plan={plan} room={room} imperial={imperial} />

      <h2 className="border-t border-stone-200 pt-3 font-medium">Add furniture</h2>

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

      <ul className="max-h-80 divide-y divide-stone-200 overflow-y-auto rounded-md border border-stone-200">
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

/**
 * The items in the room, with what's wrong where anything is, and the selected item's card:
 * its price, size and link, and buttons to turn or remove it.
 */
function RoomItems({ plan, room, imperial }: { plan: Floorplan; room: Room; imperial: boolean }) {
  const products = useProducts((s) => s.byArticle);
  const selected = useFurnish((s) => s.selected);
  const select = useFurnish((s) => s.select);
  const problems = useLayoutProblems(plan);
  const items = plan.furniture.filter((f) => f.roomId === room.id);
  const item = plan.furniture.find((f) => f.id === selected);
  const product = item && products.get(item.articleNo);
  const why = useIntents((s) => item && whyOf(item, s.furnishing));
  const planned = useIntents((s) => s.furnishing?.rooms.find((r) => r.roomId === room.id));
  const scores = useScores(plan);
  const score = scores.now.rooms.get(room.id)?.score;
  const furnished = scores.furnished.get(room.id);
  const total = items.reduce((sum, f) => sum + (products.get(f.articleNo)?.priceCad ?? 0), 0);
  // Problems with the room's walkways that no one item is to blame for.
  const ids = new Set(plan.furniture.map((f) => f.id));
  const roomProblems = problems.all.filter(
    (p) => p.roomId === room.id && !p.ids.some((id) => ids.has(id)),
  );

  return (
    <section className="space-y-2">
      <header className="flex items-baseline justify-between">
        <h2 className="font-medium">
          In the {room.name}: {items.length} item{items.length === 1 ? '' : 's'}
          {items.length > 0 && `, ${formatPrice(total)}`}
        </h2>
        <span className="flex gap-2 text-xs">
          <button type="button" className="underline" onClick={undo} title="Ctrl+Z">
            Undo
          </button>
          <button type="button" className="underline" onClick={redo} title="Ctrl+Shift+Z">
            Redo
          </button>
        </span>
      </header>

      {score !== undefined && (
        <p className="text-xs text-stone-500">
          Layout score {score.toFixed(2)}
          {furnished !== undefined && ` (${furnished.toFixed(2)} as furnished)`}
          {planned?.budgetCad !== undefined &&
            ` · ${formatPrice(planned.budgetCad)} was set aside for it`}
        </p>
      )}
      {items.length === 0 && (
        <p className="text-stone-500">Nothing yet: pick something below to place it.</p>
      )}
      {roomProblems.map((p, i) => (
        <p key={i} className="text-red-700">
          {p.message}
        </p>
      ))}
      {items.length > 0 && (
        <ul className="divide-y divide-stone-200 rounded-md border border-stone-200">
          {items.map((f) => {
            const p = products.get(f.articleNo);
            const wrong = problems.byItem.get(f.id)?.length ?? 0;
            return (
              <li key={f.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => select(f.id === selected ? undefined : f.id)}
                  className={`flex min-w-0 flex-1 justify-between gap-2 px-3 py-1.5 text-left ${
                    f.id === selected ? 'bg-stone-100' : 'hover:bg-stone-50'
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {wrong > 0 && <span className="mr-1 text-red-700">●</span>}
                    {p ? familyName(p) : 'Loading…'}
                  </span>
                  <span className="shrink-0 text-stone-500">{p && formatPrice(p.priceCad)}</span>
                </button>
                {p && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 text-stone-500 hover:text-stone-800"
                    title={`${p.articleNo} on IKEA.ca`}
                    aria-label={`${familyName(p)} on IKEA.ca`}
                  >
                    ↗
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {item && product && (
        <section className="space-y-1.5 rounded-md bg-stone-50 p-2">
          <p className="font-medium">{product.name}</p>
          <p>
            {formatPrice(product.priceCad)} · {formatLength(product.dims.w, imperial)} wide ×{' '}
            {formatLength(product.dims.d, imperial)} deep
            {product.status === 'discontinued' && ' · no longer sold at IKEA'}
          </p>
          <a className="block underline" href={product.url} target="_blank" rel="noreferrer">
            {product.articleNo} on IKEA.ca
          </a>
          {why && (
            <p>
              <span className="text-stone-500">Why here: </span>
              {why}
            </p>
          )}
          {(problems.byItem.get(item.id) ?? []).map((p, i) => (
            <p key={i} className="text-red-700">
              {p.message}
            </p>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="rounded-md border border-stone-300 bg-white px-2 py-1"
              onClick={() => rotateItem(item.id, Math.PI / 2)}
            >
              Turn (R)
            </button>
            <button
              type="button"
              className="rounded-md border border-stone-300 bg-white px-2 py-1"
              onClick={() => removeItem(item.id)}
            >
              Remove (Delete)
            </button>
          </div>
          <p className="text-xs text-stone-500">
            Drag it to move it; it snaps to the walls unless you hold Alt. Arrows nudge it.
          </p>
        </section>
      )}
    </section>
  );
}
