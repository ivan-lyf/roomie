import type { Floorplan, Placement, Product } from '@roomie/schema';
import { clsx } from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { fetchProducts } from '../../api';
import { familyName, groupFamilies, optionChoices, pickVariant, swapOptions } from '../../catalog';
import { CATEGORIES, formatDollars, formatLength } from '../../format';
import { furnitureTotals, swapItem, swapProblems, swapSpot } from '../../furnishing';
import { useFurnish } from '../../stores/furnish';
import { useIntents } from '../../stores/intents';
import { useProducts } from '../../stores/products';
import { useWorkspace } from '../../stores/workspace';
import { Button, Notice, Price, Sheet } from '../kit';

type Props = { plan: Floorplan; imperial: boolean };

/** "+$150", "−$80" or "Same price" */
function difference(cad: number): string {
  if (Math.abs(cad) < 0.005) return 'Same price';
  return `${cad > 0 ? '+' : '−'}${formatDollars(Math.abs(cad))}`;
}

/** The swap drawer (§4.6): others of the same kind that fit, each shown in place on hover. */
export function SwapSheet({ plan, imperial }: Props) {
  const open = useWorkspace((s) => s.sheet === 'swap');
  const set = useWorkspace((s) => s.set);
  const selected = useFurnish((s) => s.selected);
  const item = plan.furniture.find((f) => f.id === selected);
  const product = useProducts((s) => (item ? s.byArticle.get(item.articleNo) : undefined));
  const shown = open && item && product;
  return (
    <Sheet
      open={Boolean(shown)}
      onOpenChange={(o) => !o && set({ sheet: undefined })}
      title={product ? `Other ${CATEGORIES[product.category].toLowerCase()} that fit here` : 'Swap'}
      description="Point at one to see it in place. Choose one to look closer."
    >
      {shown && (
        <SwapList key={item.id} plan={plan} item={item} product={product} imperial={imperial} />
      )}
    </Sheet>
  );
}

function SwapList({
  plan,
  item,
  product,
  imperial,
}: {
  plan: Floorplan;
  item: Placement;
  product: Product;
  imperial: boolean;
}) {
  const [loaded, setLoaded] = useState<Product[]>();
  const [failed, setFailed] = useState(false);
  const [anySize, setAnySize] = useState(false);
  const [maxPrice, setMaxPrice] = useState('');
  const [hovered, setHovered] = useState<Product>();
  const [picked, setPicked] = useState<Product>();
  const products = useProducts((s) => s.byArticle);
  const budget = useIntents((s) => s.furnishing?.budgetCad ?? undefined);
  const close = () => useWorkspace.getState().set({ sheet: undefined });

  useEffect(() => {
    const ctrl = new AbortController();
    fetchProducts(product.category, ctrl.signal)
      .then((found) => {
        useProducts.getState().add(found);
        setLoaded(found);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setFailed(true);
      });
    return () => ctrl.abort();
  }, [product.category]);

  // The one picked, or else pointed at, stands in the item's place until the sheet closes.
  const preview = picked ?? hovered;
  useEffect(() => {
    const { setPreview } = useFurnish.getState();
    if (!preview) return setPreview(undefined);
    const { x, y, rotation } = swapSpot(item, preview, plan);
    setPreview({ id: item.id, articleNo: preview.articleNo, x, y, rotation, roomId: item.roomId });
  }, [preview, item, plan]);
  useEffect(() => () => useFurnish.getState().setPreview(undefined), []);

  const total = furnitureTotals(plan.furniture, products).home.priceCad;
  const typed = Number(maxPrice.replace(/[^\d.]/g, ''));
  const limit = typed > 0 ? typed : undefined;
  const options = useMemo(
    () => swapOptions(product, loaded ?? [], { anySize, maxPrice: limit }),
    [product, loaded, anySize, limit],
  );
  // Each family by its variant closest to the item, the ones that fit first, then by price.
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
          Math.abs(a.variant.priceCad - product.priceCad) - Math.abs(b.variant.priceCad - product.priceCad),
      );
  }, [options, plan, item.id, products, product.priceCad]);
  const pickedFamily = picked && families.find((f) => f.id === picked.familyId);
  const pickedProblems = picked ? swapProblems(plan, products, item.id, picked) : [];

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-line p-5 text-[15px]">
        <label className="flex items-center gap-2">
          <span className="text-ink-muted">Up to</span>
          <span className="font-mono">$</span>
          <input
            inputMode="numeric"
            value={maxPrice}
            placeholder="any price"
            onChange={(e) => setMaxPrice(e.target.value)}
            className="w-28 rounded-control border border-line-strong px-2 py-1.5 font-mono"
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={anySize} onChange={(e) => setAnySize(e.target.checked)} />
          Show other sizes too
        </label>
        {budget !== undefined && (
          <p className="m-0 text-sm text-ink-muted">
            Your home is at <Price>{formatDollars(total)}</Price> of your{' '}
            <Price>{formatDollars(budget)}</Price> budget.
          </p>
        )}
      </div>

      {failed && (
        <Notice tone="danger" className="m-5">
          We couldn&apos;t load other {CATEGORIES[product.category].toLowerCase()}. Try again in a moment.
        </Notice>
      )}
      {!loaded && !failed && (
        <p aria-live="polite" className="m-0 p-5 text-ink-muted">
          Finding other {CATEGORIES[product.category].toLowerCase()}…
        </p>
      )}
      {loaded && families.length === 0 && (
        <p className="m-0 p-5 text-ink-muted">Nothing like it: show other sizes, or raise the price.</p>
      )}

      {picked && pickedFamily && (
        <section className="flex flex-col gap-3 border-b-2 border-rule bg-canvas p-5">
          <p className="m-0 font-semibold">
            {familyName(picked)} · <Price>{formatDollars(picked.priceCad)}</Price>{' '}
            <span className="font-normal text-ink-muted">({difference(picked.priceCad - product.priceCad)})</span>
          </p>
          {optionChoices(pickedFamily.variants).map(({ name, values }) => {
            const value = picked.options.find((o) => o.name === name)?.value ?? '';
            return (
              <label key={name} className="flex items-center gap-2 text-[15px]">
                <span className="w-24 shrink-0 text-ink-muted">{name}</span>
                <select
                  value={value}
                  onChange={(e) => {
                    const next = pickVariant(pickedFamily.variants, picked, name, e.target.value);
                    if (next) setPicked(next);
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
          {pickedProblems.length > 0 ? (
            <Notice tone="danger">Too big for this spot: {pickedProblems[0]!.message}</Notice>
          ) : (
            <Button
              onClick={() => {
                swapItem(item.id, picked);
                close();
              }}
            >
              Use this one
            </Button>
          )}
        </section>
      )}

      <ul className="m-0 list-none p-0" onMouseLeave={() => setHovered(undefined)}>
        {families.map((f) => {
          const fits = f.problems.length === 0;
          const on = f.id === pickedFamily?.id;
          return (
            <li key={f.id} className="border-b border-line">
              <button
                type="button"
                onMouseEnter={() => setHovered(f.variant)}
                onFocus={() => setHovered(f.variant)}
                onClick={() => setPicked(on ? undefined : f.variant)}
                aria-pressed={on}
                className={clsx(
                  'flex w-full gap-3 px-5 py-3 text-left',
                  on ? 'bg-accent-tint' : 'hover:bg-canvas',
                )}
              >
                <span className="flex size-16 shrink-0 items-center justify-center border border-line bg-surface">
                  {f.variant.imageUrl && (
                    <img src={f.variant.imageUrl} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-semibold">{f.name}</span>
                  {f.variant.color && <span className="text-sm text-ink-muted">{f.variant.color}</span>}
                  <span className="font-mono text-sm">
                    {difference(f.variant.priceCad - product.priceCad)} ·{' '}
                    {formatLength(f.variant.dims.w, imperial)} × {formatLength(f.variant.dims.d, imperial)}
                  </span>
                  {f.variants.length > 1 && (
                    <span className="text-sm text-ink-muted">{f.variants.length} colours and sizes</span>
                  )}
                  <span className={clsx('text-sm font-medium', fits ? 'text-ok' : 'text-danger')}>
                    {fits ? 'Fits' : 'Too big for this spot'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
