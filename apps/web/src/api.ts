import {
  type Category,
  Floorplan,
  FloorplanEdit,
  FloorplanSummary,
  type GenerationInputs,
  GenerationJob,
  Product,
} from '@roomie/schema';
import { z } from 'zod';

const ProductList = z.array(Product);

export async function fetchProducts(category: Category, signal?: AbortSignal): Promise<Product[]> {
  const res = await fetch(`/api/products?category=${category}`, { signal });
  if (!res.ok) throw new Error(`GET /api/products: HTTP ${res.status}`);
  return ProductList.parse(await res.json());
}

/** Products by article number, discontinued ones too; any the catalog doesn't have are left out. */
export async function fetchProductsByArticle(
  articleNos: readonly string[],
  signal?: AbortSignal,
): Promise<Product[]> {
  const res = await fetch(`/api/products?articleNo=${articleNos.join(',')}`, { signal });
  if (!res.ok) throw new Error(`GET /api/products: HTTP ${res.status}`);
  return ProductList.parse(await res.json());
}

/** An error the API answered with. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API's error message, else the status. */
async function failure(res: Response, what: string): Promise<ApiError> {
  const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
  return new ApiError(body?.error ?? `${what}: HTTP ${res.status}`, res.status);
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

/**
 * Has the plan reader read the plan's image (up to a few minutes). A plan already traced is
 * only read again with `replace`, which replaces what was traced.
 */
export async function readFloorplan(id: string, replace = false): Promise<Floorplan> {
  const query = replace ? '?replace=1' : '';
  const res = await fetch(`/api/floorplans/${encodeURIComponent(id)}/read${query}`, {
    method: 'POST',
  });
  if (!res.ok) throw await failure(res, 'POST /api/floorplans/:id/read');
  return Floorplan.parse(await res.json());
}

/** Starts furnishing a saved home; answers at once with the generation to poll. */
export async function startFurnishing(id: string, inputs: GenerationInputs): Promise<string> {
  const res = await fetch(`/api/floorplans/${encodeURIComponent(id)}/layouts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(inputs),
  });
  if (!res.ok) throw await failure(res, 'POST /api/floorplans/:id/layouts');
  return z.object({ generationId: z.uuid() }).parse(await res.json()).generationId;
}

/** How a furnishing is going, and what came of it. */
export async function fetchGeneration(id: string, signal?: AbortSignal): Promise<GenerationJob> {
  const res = await fetch(`/api/generations/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) throw await failure(res, 'GET /api/generations/:id');
  return GenerationJob.parse(await res.json());
}
