import { clsx } from 'clsx';
import { ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { familyName } from '../catalog';
import { formatDollars, formatPrice } from '../format';
import { DEMO_ID, usePlan } from '../plans';
import { byRoom, type RoomGroup, shoppingList, toCsv, toText } from '../shopping';
import { useIntents } from '../stores/intents';
import { useProducts, useProductsFor } from '../stores/products';
import { Button, ButtonLink, Notice, Price } from '../ui/kit';

const day = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' });

/** A name fit for a file: "Sample fr-56 (Opus)" -> "sample-fr-56-opus". */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'home';

/** Everything in the home, room by room, to buy at IKEA (§4.7): copy it, print it, or save it. */
export function ListPage({ id }: { id: string }) {
  const { plan, error } = usePlan(id);
  const loading = useProductsFor(plan?.furniture.map((f) => f.articleNo) ?? []);
  const products = useProducts((s) => s.byArticle);
  const budget = useIntents((s) => (s.planId === id ? (s.furnishing?.budgetCad ?? undefined) : undefined));
  const list = useMemo(() => plan && shoppingList(plan, products), [plan, products]);
  const groups = useMemo(() => (plan && list ? byRoom(list, plan.rooms) : []), [plan, list]);
  const [copied, setCopied] = useState<string>();
  useEffect(() => void useIntents.getState().load(id === DEMO_ID ? undefined : id), [id]);

  if (error) {
    return (
      <main className="p-8 text-lg">
        We couldn&apos;t open this list.{' '}
        <Link href="/homes" className="underline">
          Back to your homes
        </Link>
      </main>
    );
  }
  if (!plan || !list) {
    return (
      <main aria-live="polite" className="p-8 text-ink-muted">
        Opening your shopping list…
      </main>
    );
  }

  const copy = () =>
    navigator.clipboard.writeText(toText(list)).then(
      () => setCopied('Copied. Paste it into a note or an email.'),
      () => setCopied("Your browser didn't let us copy. Select the list and copy it instead."),
    );
  const saveCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(list)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(plan.name)}-shopping-list.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const left = budget !== undefined ? budget - list.totalCad : undefined;

  return (
    <div className="min-h-full bg-canvas print:bg-white">
      <header className="flex items-center gap-8 border-b-2 border-rule px-8 py-4 print:hidden">
        <Link href={`/plans/${id}`} className="text-[15px] text-ink-muted hover:text-ink">
          ← Back to your home
        </Link>
      </header>
      <main className="mx-auto flex max-w-[880px] flex-col gap-6 px-8 pt-10 pb-16 print:p-0">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] font-bold tracking-tight">Shopping list</h1>
          <p className="m-0 text-ink-muted">{plan.name}</p>
        </div>

        {list.lines.length === 0 ? (
          <Notice tone="info">
            Nothing to buy yet.{' '}
            <Link href={`/plans/${id}`} className="font-semibold underline">
              Furnish your home
            </Link>{' '}
            and everything in it lands here.
          </Notice>
        ) : (
          <>
            {loading && (
              <p aria-live="polite" className="m-0 text-ink-muted">
                Looking up the prices…
              </p>
            )}
            <div className="border-t-2 border-rule">
              {groups.map((g) => (
                <Room key={g.roomId} id={id} group={g} />
              ))}
            </div>

            <div className="flex flex-col gap-2 border-t-2 border-rule pt-4">
              <p className="m-0 flex flex-wrap items-baseline gap-x-8 gap-y-1 text-xl">
                <span className="font-bold">
                  Total <Price>{formatDollars(list.totalCad)}</Price>
                </span>
                {budget !== undefined && left !== undefined && (
                  <span className={clsx('text-lg', left < 0 ? 'text-warn' : 'text-ink-muted')}>
                    Your budget <Price>{formatDollars(budget)}</Price>
                    {' · '}
                    {left >= 0 ? (
                      <>
                        <Price>{formatDollars(left)}</Price> left
                      </>
                    ) : (
                      <>
                        <Price>{formatDollars(-left)}</Price> over
                      </>
                    )}
                  </span>
                )}
              </p>
              {list.pricedAt && (
                <p className="m-0 font-mono text-[13px] text-ink-muted">
                  Prices from IKEA.ca on {day.format(list.pricedAt)}. Check before buying.
                </p>
              )}
              {list.unavailableCad > 0 && (
                <Notice tone="warn">
                  {formatPrice(list.unavailableCad)} of it is for pieces IKEA no longer sells. Swap
                  them in your home before buying.
                </Notice>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 print:hidden">
              <Button variant="secondary" onClick={() => void copy()}>
                Copy list
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
              <Button variant="link" onClick={saveCsv}>
                Save as a spreadsheet (CSV)
              </Button>
              {copied && (
                <span role="status" className="text-ink-muted">
                  {copied}
                </span>
              )}
            </div>
          </>
        )}
        <p className="m-0 font-mono text-[13px] text-ink-muted">Roomie isn&apos;t affiliated with IKEA.</p>
        <ButtonLink href={`/plans/${id}`} variant="link" className="self-start print:hidden">
          ← Back to your home
        </ButtonLink>
      </main>
    </div>
  );
}

function Room({ id, group }: { id: string; group: RoomGroup }) {
  return (
    <section className="border-b border-rule py-4">
      <h2 className="m-0 mb-2 flex items-baseline justify-between text-xl font-bold tracking-tight">
        {group.name}
        <Price className="text-lg font-medium">{formatDollars(group.subtotalCad)}</Price>
      </h2>
      <ul className="m-0 list-none p-0">
        {group.lines.map(({ line, quantity, cad }) => {
          const p = line.product;
          return (
            <li
              key={line.articleNo}
              className="grid grid-cols-[56px_minmax(0,1fr)_auto_auto] items-center gap-4 border-t border-line py-2.5"
            >
              <span className="flex size-14 items-center justify-center border border-line bg-surface">
                {p?.imageUrl && (
                  <img
                    src={p.imageUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="max-h-full max-w-full object-contain"
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  {p ? familyName(p) : 'No longer in the catalog'}
                  {p && (
                    <span className="font-normal text-ink-muted">
                      {' · '}
                      {p.name.split(' - ').slice(1).join(' - ') || p.color}
                    </span>
                  )}
                </span>
                <span className="font-mono text-xs text-ink-muted">{line.articleNo}</span>
                {line.flag && (
                  <span className="text-sm text-warn">
                    {line.flag === 'discontinued' ? 'No longer sold at IKEA' : 'No longer in the catalog'}
                    <span className="print:hidden">
                      {' · '}
                      <Link href={`/plans/${id}?room=${group.roomId}`} className="underline">
                        swap it
                      </Link>
                    </span>
                  </span>
                )}
              </span>
              <span className="font-mono text-sm whitespace-nowrap text-ink-muted">× {quantity}</span>
              <span className="flex items-center gap-3">
                <Price className="w-24 text-right">{cad === undefined ? '–' : formatDollars(cad)}</Price>
                {p ? (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${familyName(p)} on IKEA.ca (opens in a new tab)`}
                    className="text-ink-muted hover:text-ink print:hidden"
                  >
                    <ExternalLink size={16} aria-hidden />
                  </a>
                ) : (
                  <span className="w-4" />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
