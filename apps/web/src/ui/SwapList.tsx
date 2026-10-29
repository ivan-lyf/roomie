import type { Floorplan, Placement, Product } from '@roomie/schema';
import { useEffect, useMemo, useState } from 'react';
import { fetchProducts } from '../api';
import { groupFamilies, optionChoices, pickVariant, swapOptions } from '../catalog';
import { CATEGORIES, formatLength, formatPrice } from '../format';
import { furnitureTotals, swapItem, swapProblems, swapSpot } from '../furnishing';
import { useFurnish } from '../stores/furnish';
import { useIntents } from '../stores/intents';
import { useProducts } from '../stores/products';

type Props = { plan: Floorplan; item: Placement; product: Product; imperial: boolean };

/** "+$120.00", "−$45.00" or "same price" */
function difference(cad: number): string {
  if (Math.abs(cad) < 0.005) return 'same price';
  return `${cad > 0 ? '+' : '−'}${formatPrice(Math.abs(cad))}`;
}

/**
 * What the selected item could be swapped for: others of its category about its size, within
 * the budget, each saying what it costs more or less and whether it fits where the item stands.
 * The one pointed at or picked is shown in its place, checked like any other edit.
 */
export function SwapList({ plan, item, product, imperial }: Props) {
  const [loaded, setLoaded] = useState<Product[]>();
  const [error, setError] = useState<string>();
  const [anySize, setAnySize] = useState(false);
  const [withinBudget, setWithinBudget] = useState(true);
  const [maxPrice, setMaxPrice] = useState('');
  const [hovered, setHovered] = useState<Product>();
  const [picked, setPicked] = useState<Product>();
  const products = useProducts((s) => s.byArticle);
  const budget = useIntents((s) => s.furnishing?.budgetCad ?? undefined);
  const close = () => useFurnish.getState().setSwapping(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchProducts(product.category, ctrl.signal)
      .then((found) => {
        useProducts.getState().add(found);
        setLoaded(found);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [product.category]);

  // The one picked, or else pointed at, stands in the item's place until the list closes.
  const shown = picked ?? hovered;
  useEffect(() => {
    const { setPreview } = useFurnish.getState();
    if (!shown) return setPreview(undefined);
    const { x, y, rotation } = swapSpot(item, shown, plan);
    setPreview({ id: item.id, articleNo: shown.articleNo, x, y, rotation, roomId: item.roomId });
  }, [shown, item, plan]);
  useEffect(() => () => useFurnish.getState().setPreview(undefined), []);

  // Within budget: what's left of it once this item is taken out.
  const total = furnitureTotals(plan.furniture, products).home.priceCad;
  const limit =
    budget !== undefined && withinBudget
      ? budget - total + product.priceCad
      : Number(maxPrice) > 0
        ? Number(maxPrice)
        : undefined;
  const options = useMemo(
    () => swapOptions(product, loaded ?? [], { anySize, maxPrice: limit }),
    [product, loaded, anySize, limit],
  );
  // Each family by its variant closest to the item, those that fit where it stands first.
  const families = useMemo(() => {
    const known = new Map(products);
    return groupFamilies(options)
      .map((family) => {
        const variant = family.variants[0]!;
        return { ...family, variant, problems: swapProblems(plan, known, item.id, variant) };
      })
      .sort(
        (a, b) =>
          Number(a.problems.length > 0) - Number(b.problems.length > 0) ||
          a.variant.priceCad - b.variant.priceCad,
      );
  }, [options, plan, item.id, products]);
  const pickedFamily = picked && families.find((f) => f.id === picked.familyId);
  const pickedProblems = picked && swapProblems(plan, products, item.id, picked);

  return (
    <section className="space-y-2 rounded-md border border-stone-200 bg-white p-2">
      <header className="flex items-baseline justify-between">
        <h3 className="font-medium">Swap it for…</h3>
        <button type="button" className="text-xs underline" onClick={close}>
          Close
        </button>
      </header>
      <fieldset className="space-y-1 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={anySize} onChange={(e) => setAnySize(e.target.checked)} />
          Any size, not just about this one&apos;s
        </label>
        {budget !== undefined ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={withinBudget}
              onChange={(e) => setWithinBudget(e.target.checked)}
            />
            Only what keeps the home within its {formatPrice(budget)} budget
          </label>
        ) : (
          <label className="flex items-center gap-2">
            <span className="text-stone-500">Up to $</span>
            <input
              className="w-24 rounded-md border border-stone-300 p-1"
              inputMode="numeric"
              value={maxPrice}
              placeholder="any"
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </label>
        )}
      </fieldset>

      {error && <p className="text-red-700">{error}</p>}
      {!loaded && !error && (
        <p className="text-stone-500">Loading {CATEGORIES[product.category].toLowerCase()}…</p>
      )}
      {loaded && families.length === 0 && (
        <p className="text-stone-500">Nothing like it matches: try any size, or a higher limit.</p>
      )}

      <ul
        className="max-h-64 divide-y divide-stone-200 overflow-y-auto rounded-md border border-stone-200"
        onMouseLeave={() => setHovered(undefined)}
      >
        {families.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onMouseEnter={() => setHovered(f.variant)}
              onClick={() => setPicked(f.id === pickedFamily?.id ? undefined : f.variant)}
              className={`w-full px-3 py-1.5 text-left ${f.id === pickedFamily?.id ? 'bg-stone-100' : 'hover:bg-stone-50'}`}
            >
              <span className="block font-medium">{f.name}</span>
              <span className="block text-xs text-stone-500">
                {formatPrice(f.variant.priceCad)} (
                {difference(f.variant.priceCad - product.priceCad)}) ·{' '}
                {formatLength(f.variant.dims.w, imperial)} ×{' '}
                {formatLength(f.variant.dims.d, imperial)}
                {f.variants.length > 1 && ` · ${f.variants.length} variants`}
              </span>
              <span
                className={`block text-xs ${f.problems.length > 0 ? 'text-red-700' : 'text-green-700'}`}
              >
                {f.problems.length > 0 ? f.problems[0]!.message : 'Fits where it stands'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {picked && pickedFamily && (
        <section className="space-y-2 rounded-md bg-stone-50 p-2">
          {optionChoices(pickedFamily.variants).map(({ name, values }) => {
            const value = picked.options.find((o) => o.name === name)?.value ?? '';
            return (
              <label key={name} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-stone-500">{name}</span>
                <select
                  className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white p-1"
                  value={value}
                  onChange={(e) => {
                    const next = pickVariant(pickedFamily.variants, picked, name, e.target.value);
                    if (next) setPicked(next);
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
            {picked.name}: {formatPrice(picked.priceCad)} (
            {difference(picked.priceCad - product.priceCad)})
          </p>
          {pickedProblems?.map((p, i) => (
            <p key={i} className="text-red-700">
              {p.message}
            </p>
          ))}
          <button
            type="button"
            className="w-full rounded-md bg-stone-800 px-3 py-1.5 text-white"
            onClick={() => {
              swapItem(item.id, picked);
              close();
            }}
          >
            Swap it
          </button>
        </section>
      )}
    </section>
  );
}
