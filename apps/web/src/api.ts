import { type Category, Product } from '@roomie/schema';
import { z } from 'zod';

const ProductList = z.array(Product);

export async function fetchProducts(category: Category, signal?: AbortSignal): Promise<Product[]> {
  const res = await fetch(`/api/products?category=${category}`, { signal });
  if (!res.ok) throw new Error(`GET /api/products: HTTP ${res.status}`);
  return ProductList.parse(await res.json());
}
