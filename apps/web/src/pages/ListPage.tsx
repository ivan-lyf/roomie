import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { formatPrice } from '../format';
import { usePlan } from '../plans';
import { type ShoppingLine, shoppingList, toCsv, toText } from '../shopping';
import { useProducts, useProductsFor } from '../stores/products';

const day = new Intl.DateTimeFormat('en-CA', { dateStyle: 'long' });

/** A name fit for a file: "Sample fr-56 (Opus)" -> "sample-fr-56-opus". */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'home';

/**
 * Everything the home's furniture comes to, to buy at IKEA: one line per product with how many,
 * where they go, prices and links, and what to look at again first. Copy, export or print it.
 */
export function ListPage({ id }: { id: string }) {
  const { plan, error } = usePlan(id);
  const loading = useProductsFor(plan?.furniture.map((f) => f.articleNo) ?? []);
  const products = useProducts((s) => s.byArticle);
  const list = useMemo(() => plan && shoppingList(plan, products), [plan, products]);
  const [copied, setCopied] = useState<string>();

  if (error) return <p className="p-8 text-sm text-stone-700">{error}</p>;
  if (!plan || !list) return null;

  const copy = () =>
    navigator.clipboard.writeText(toText(list)).then(
      () => setCopied('Copied the article numbers.'),
      () => setCopied("Your browser didn't let the page copy: select the list instead."),
    );
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(list)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(plan.name)}-shopping-list.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const button = 'rounded-md border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50';

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-8 text-sm text-stone-800 print:p-0">
      <Link href={`/plans/${id}/3d`} className="text-xs text-stone-500 print:hidden">
        ← Back to the home
      </Link>
      <header>
        <h1 className="text-xl font-semibold">Shopping list: {plan.name}</h1>
        <p className="text-stone-500">
          {list.count} item{list.count === 1 ? '' : 's'}, {formatPrice(list.totalCad)}
          {list.pricedAt && ` · prices from IKEA.ca on ${day.format(list.pricedAt)}`}; check them
          before buying.
        </p>
      </header>

      {list.lines.length === 0 ? (
        <p className="text-stone-500">
          Nothing to buy yet: furnish the home first.{' '}
          <Link href={`/plans/${id}/3d`} className="underline">
            Open it in 3D
          </Link>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button type="button" className={button} onClick={() => void copy()}>
              Copy article numbers
            </button>
            <button type="button" className={button} onClick={exportCsv}>
              Export CSV
            </button>
            <button type="button" className={button} onClick={() => window.print()}>
              Print
            </button>
            {copied && <span className="text-xs text-stone-500">{copied}</span>}
          </div>
          {loading && <p className="text-stone-500">Looking up the products…</p>}

          <table className="w-full border-collapse">
            <thead className="border-b border-stone-300 text-left text-xs text-stone-500">
              <tr>
                <th className="w-14 py-2 print:hidden" />
                <th className="py-2">Product</th>
                <th className="py-2">Rooms</th>
                <th className="py-2 pl-4 text-right">Qty</th>
                <th className="py-2 pl-4 text-right">Each</th>
                <th className="py-2 pl-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {list.lines.map((line) => (
                <Line key={line.articleNo} id={id} line={line} />
              ))}
            </tbody>
            <tfoot className="border-t border-stone-300 font-medium">
              <tr>
                <td className="print:hidden" />
                <td className="py-2" colSpan={2}>
                  Total
                </td>
                <td className="py-2 pl-4 text-right whitespace-nowrap">{list.count}</td>
                <td />
                <td className="py-2 pl-4 text-right whitespace-nowrap">
                  {formatPrice(list.totalCad)}
                </td>
              </tr>
            </tfoot>
          </table>
          {list.unavailableCad > 0 && (
            <p className="text-amber-700">
              {formatPrice(list.unavailableCad)} of it is for items IKEA no longer sells: swap them
              for others before buying.
            </p>
          )}
        </>
      )}
    </main>
  );
}

function Line({ id, line }: { id: string; line: ShoppingLine }) {
  const { product } = line;
  const first = line.rooms[0];
  return (
    <tr className="align-top">
      <td className="py-2 print:hidden">
        {product?.imageUrl && (
          <img
            src={product.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-12 w-12 object-contain"
          />
        )}
      </td>
      <td className="py-2 pr-2">
        <span className="block font-medium">{product?.name ?? 'Not in the catalog'}</span>
        <span className="block text-xs text-stone-500">
          {product ? (
            <a href={product.url} target="_blank" rel="noreferrer" className="underline">
              {line.articleNo} on IKEA.ca
            </a>
          ) : (
            line.articleNo
          )}
        </span>
        {line.flag && first && (
          <span className="block text-xs text-amber-700">
            {line.flag === 'discontinued' ? 'No longer sold at IKEA' : 'No longer in the catalog'}
            <span className="print:hidden">
              {': '}
              <Link href={`/plans/${id}/3d?room=${first.roomId}`} className="underline">
                swap it
              </Link>
            </span>
          </span>
        )}
      </td>
      <td className="py-2 pr-2">
        {line.rooms.map((r, i) => (
          <span key={r.roomId} className="whitespace-nowrap">
            {i > 0 && ', '}
            {r.name}
            {r.quantity > 1 && ` ×${r.quantity}`}
          </span>
        ))}
      </td>
      <td className="py-2 pl-4 text-right whitespace-nowrap">{line.quantity}</td>
      <td className="py-2 pl-4 text-right whitespace-nowrap">
        {line.unitCad === undefined ? '–' : formatPrice(line.unitCad)}
      </td>
      <td className="py-2 pl-4 text-right whitespace-nowrap">
        {line.lineCad === undefined ? '–' : formatPrice(line.lineCad)}
      </td>
    </tr>
  );
}
