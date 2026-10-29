import type { Product } from '@roomie/schema';
import { useEffect } from 'react';
import { create } from 'zustand';
import { fetchProductsByArticle } from '../api';

// The products the app has seen, by article number, from browsing the catalog or looking up a
// home's furniture: never undone, never saved.

type ProductsState = {
  byArticle: ReadonlyMap<string, Product>;
  /** Article numbers the catalog doesn't have. */
  missing: ReadonlySet<string>;
  add: (products: readonly Product[]) => void;
  setMissing: (articleNos: readonly string[]) => void;
};

export const useProducts = create<ProductsState>()((set) => ({
  byArticle: new Map(),
  missing: new Set(),
  add: (products) =>
    set(({ byArticle }) => {
      if (products.every((p) => byArticle.get(p.articleNo) === p)) return {};
      const next = new Map(byArticle);
      for (const p of products) next.set(p.articleNo, p);
      return { byArticle: next };
    }),
  setMissing: (articleNos) =>
    set(({ missing }) =>
      articleNos.length === 0 ? {} : { missing: new Set([...missing, ...articleNos]) },
    ),
}));

/** Article numbers being looked up now, so two components don't ask twice. */
const pending = new Set<string>();

/** The article numbers not seen yet, once each, in order. */
export function unseen(
  articleNos: readonly string[],
  state: Pick<ProductsState, 'byArticle' | 'missing'>,
  asked: ReadonlySet<string> = pending,
): string[] {
  return [...new Set(articleNos)].filter(
    (a) => !state.byArticle.has(a) && !state.missing.has(a) && !asked.has(a),
  );
}

/**
 * Looks up the products for these article numbers that haven't been seen yet. Returns whether
 * any are still loading, so nothing is judged on a product that hasn't arrived.
 */
export function useProductsFor(articleNos: readonly string[]): boolean {
  const key = [...new Set(articleNos)].sort().join(',');
  const loading = useProducts(
    (s) => key !== '' && key.split(',').some((a) => !s.byArticle.has(a) && !s.missing.has(a)),
  );
  useEffect(() => {
    if (key === '') return;
    const wanted = unseen(key.split(','), useProducts.getState());
    if (wanted.length === 0) return;
    for (const a of wanted) pending.add(a);
    fetchProductsByArticle(wanted)
      .then((found) => {
        const { add, setMissing } = useProducts.getState();
        add(found);
        const got = new Set(found.map((p) => p.articleNo));
        setMissing(wanted.filter((a) => !got.has(a)));
      })
      // Offline or the API down: leave them unseen, to ask again next time.
      .catch(() => {})
      .finally(() => {
        for (const a of wanted) pending.delete(a);
      });
  }, [key]);
  return loading;
}
