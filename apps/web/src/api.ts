import { type Category, Floorplan, FloorplanEdit, FloorplanSummary, Product } from '@roomie/schema';
import { z } from 'zod';

const ProductList = z.array(Product);

export async function fetchProducts(category: Category, signal?: AbortSignal): Promise<Product[]> {
  const res = await fetch(`/api/products?category=${category}`, { signal });
  if (!res.ok) throw new Error(`GET /api/products: HTTP ${res.status}`);
  return ProductList.parse(await res.json());
}

/** The API's error message, else the status. */
async function failure(res: Response, what: string): Promise<Error> {
  const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
  return new Error(body?.error ?? `${what}: HTTP ${res.status}`);
}

export async function fetchFloorplans(signal?: AbortSignal): Promise<FloorplanSummary[]> {
  const res = await fetch('/api/floorplans', { signal });
  if (!res.ok) throw await failure(res, 'GET /api/floorplans');
  return z.array(FloorplanSummary).parse(await res.json());
}

export async function fetchFloorplan(id: string, signal?: AbortSignal): Promise<Floorplan> {
  const res = await fetch(`/api/floorplans/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) throw await failure(res, 'GET /api/floorplans/:id');
  return Floorplan.parse(await res.json());
}

/** Uploads a plan image (PNG or JPEG) and returns the new, still empty, floorplan. */
export async function uploadFloorplan(image: Blob, name: string): Promise<Floorplan> {
  const form = new FormData();
  form.set('image', image, `${name}.png`);
  form.set('name', name);
  const res = await fetch('/api/floorplans', { method: 'POST', body: form });
  if (!res.ok) throw await failure(res, 'POST /api/floorplans');
  return Floorplan.parse(await res.json());
}

export const floorplanImageUrl = (id: string) => `/api/floorplans/${encodeURIComponent(id)}/image`;

/** Saves the editable parts of a floorplan; the server sets its status. */
export async function saveFloorplan(plan: Floorplan, signal?: AbortSignal): Promise<Floorplan> {
  const edit: FloorplanEdit = FloorplanEdit.parse(plan);
  const res = await fetch(`/api/floorplans/${encodeURIComponent(plan.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(edit),
    signal,
  });
  if (!res.ok) throw await failure(res, 'PUT /api/floorplans/:id');
  return Floorplan.parse(await res.json());
}
