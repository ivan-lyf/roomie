import { Category, type Product } from '@roomie/schema';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchProducts } from './api';
import { groupFamilies } from './catalog';
import { ProductScene, type View } from './scene/ProductScene';
import type { Size } from './scene/size';
import { CatalogPanel } from './ui/CatalogPanel';

const params = new URLSearchParams(location.search);
const initialCategory = Category.safeParse(params.get('category')).data ?? 'sofa';
/** `?view=front` looks straight at the front (+Z), for checking which way models face. */
const view: View = params.get('view') === 'front' ? 'front' : 'angle';

/** The last category loaded; it's stale while another one loads. */
type Loaded = { category: Category; products: Product[]; error?: string };

export function App() {
  const [category, setCategory] = useState<Category>(initialCategory);
  const [loaded, setLoaded] = useState<Loaded>();
  const [articleNo, setArticleNo] = useState(() => params.get('article') ?? undefined);
  const [measured, setMeasured] = useState<{ articleNo: string; size: Size }>();
  const current = loaded?.category === category ? loaded : undefined;
  const products = useMemo(() => current?.products ?? [], [current]);
  const families = useMemo(() => groupFamilies(products), [products]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchProducts(category, ctrl.signal)
      .then((list) => {
        setLoaded({ category, products: list });
        setArticleNo((selected) =>
          list.some((p) => p.articleNo === selected)
            ? selected
            : groupFamilies(list)[0]?.variants[0]?.articleNo,
        );
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoaded({ category, products: [], error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [category]);

  // Keep the URL in step, so a product can be linked to (and screenshotted).
  useEffect(() => {
    const next = new URLSearchParams(location.search);
    next.set('category', category);
    if (articleNo) next.set('article', articleNo);
    else next.delete('article');
    history.replaceState(null, '', `?${next}`);
  }, [category, articleNo]);

  const selected = products.find((p) => p.articleNo === articleNo);
  const onMeasured = useCallback(
    (size: Size) => selected && setMeasured({ articleNo: selected.articleNo, size }),
    [selected],
  );

  return (
    <main className="flex h-full">
      <CatalogPanel
        category={category}
        families={families}
        selected={selected}
        measured={measured && measured.articleNo === articleNo ? measured.size : undefined}
        loading={!current}
        error={current?.error}
        onCategory={setCategory}
        onSelect={setArticleNo}
      />
      <div className="min-w-0 flex-1">
        <ProductScene product={selected} view={view} onMeasured={onMeasured} />
      </div>
    </main>
  );
}
