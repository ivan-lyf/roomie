import type { Product } from '@roomie/schema';
import { useCallback, useEffect, useState } from 'react';
import { fetchProducts } from './api';
import { ProductScene } from './scene/ProductScene';
import type { Size } from './scene/size';
import { ProductPanel } from './ui/ProductPanel';

/** Sofas with a model first, then by name. */
const byModelThenName = (a: Product, b: Product) =>
  Number(!a.modelUrl) - Number(!b.modelUrl) || a.name.localeCompare(b.name);

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string>();
  const [articleNo, setArticleNo] = useState(
    () => new URLSearchParams(location.search).get('article') ?? undefined,
  );
  const [measured, setMeasured] = useState<{ articleNo: string; size: Size }>();

  useEffect(() => {
    const ctrl = new AbortController();
    fetchProducts('sofa', ctrl.signal)
      .then((list) => {
        const sorted = [...list].sort(byModelThenName);
        setProducts(sorted);
        setArticleNo((current) =>
          sorted.some((p) => p.articleNo === current) ? current : sorted[0]?.articleNo,
        );
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, []);

  const selected = products.find((p) => p.articleNo === articleNo);
  const onMeasured = useCallback(
    (size: Size) => selected && setMeasured({ articleNo: selected.articleNo, size }),
    [selected],
  );

  return (
    <main className="relative h-full">
      <ProductScene product={selected} onMeasured={onMeasured} />
      <ProductPanel
        products={products}
        selected={selected}
        measured={measured && measured.articleNo === articleNo ? measured.size : undefined}
        error={error}
        onSelect={setArticleNo}
      />
    </main>
  );
}
