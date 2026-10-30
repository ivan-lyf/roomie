import {
  type Category,
  Floorplan,
  FloorplanEdit,
  FloorplanSummary,
  type GenerationInputs,
  GenerationJob,
  HomeFurnishing,
  Me,
  NextPair,
  type NoteLabel,
  Product,
  Rating,
  type RatingInput,
  type RatingPair,
  RatingSaved,
  RatingSummary,
  Refusal,
  type RefusalCode,
  type RoomAgain,
} from '@roomie/schema';
import { z } from 'zod';
import { accessToken } from './auth';

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

/** An error the API answered with: for a refused AI step, why (PLAN.md M6). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: RefusalCode,
    /** When an allowance used up for the day starts again. */
    readonly resetsAt?: Date,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API's error message, else the status. */
async function failure(res: Response, what: string): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => undefined);
  const refusal = Refusal.safeParse(body);
  if (refusal.success) {
    return new ApiError(refusal.data.error, res.status, refusal.data.code, refusal.data.resetsAt);
  }
  const error = (body as { error?: unknown } | undefined)?.error;
  return new ApiError(
    typeof error === 'string' ? error : `${what}: HTTP ${res.status}`,
    res.status,
  );
}

/** Headers for a step that calls an LLM: the session's token, when signed in (PLAN.md M6). */
async function signedIn(headers: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await accessToken();
  return token ? { ...headers, authorization: `Bearer ${token}` } : headers;
}

/** The signed-in account and what it has spent on AI today. */
export async function fetchMe(signal?: AbortSignal): Promise<Me> {
  const res = await fetch('/api/me', { headers: await signedIn(), signal });
  if (!res.ok) throw await failure(res, 'GET /api/me');
  return Me.parse(await res.json());
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
 * Has the plan reader read the plan's image (up to a few minutes), signed in. A plan already
 * traced is only read again with `replace`, which replaces what was traced.
 */
export async function readFloorplan(id: string, replace = false): Promise<Floorplan> {
  const query = replace ? '?replace=1' : '';
  const res = await fetch(`/api/floorplans/${encodeURIComponent(id)}/read${query}`, {
    method: 'POST',
    headers: await signedIn(),
  });
  if (!res.ok) throw await failure(res, 'POST /api/floorplans/:id/read');
  return Floorplan.parse(await res.json());
}

/** Starts furnishing a saved home, signed in; answers at once with the generation to poll. */
export async function startFurnishing(id: string, inputs: GenerationInputs): Promise<string> {
  const res = await fetch(`/api/floorplans/${encodeURIComponent(id)}/layouts`, {
    method: 'POST',
    headers: await signedIn({ 'content-type': 'application/json' }),
    body: JSON.stringify(inputs),
  });
  if (!res.ok) throw await failure(res, 'POST /api/floorplans/:id/layouts');
  return z.object({ generationId: z.uuid() }).parse(await res.json()).generationId;
}

/**
 * Starts furnishing one room again, the rest kept: new pieces need sign-in, a rearrange doesn't.
 * Answers with the generation to poll.
 */
export async function startRoomAgain(id: string, roomId: string, again: RoomAgain) {
  const url = `/api/floorplans/${encodeURIComponent(id)}/rooms/${encodeURIComponent(roomId)}/layouts`;
  const res = await fetch(url, {
    method: 'POST',
    headers: await signedIn({ 'content-type': 'application/json' }),
    body: JSON.stringify(again),
  });
  if (!res.ok) throw await failure(res, 'POST /api/floorplans/:id/rooms/:roomId/layouts');
  return z.object({ generationId: z.uuid() }).parse(await res.json()).generationId;
}

/** How a furnishing is going, and what came of it. */
export async function fetchGeneration(id: string, signal?: AbortSignal): Promise<GenerationJob> {
  const res = await fetch(`/api/generations/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) throw await failure(res, 'GET /api/generations/:id');
  return GenerationJob.parse(await res.json());
}

/** What each room of a saved home was last furnished from, with its budget and style. */
export async function fetchFurnishing(id: string, signal?: AbortSignal): Promise<HomeFurnishing> {
  const res = await fetch(`/api/floorplans/${encodeURIComponent(id)}/furnishing`, { signal });
  if (!res.ok) throw await failure(res, 'GET /api/floorplans/:id/furnishing');
  return HomeFurnishing.parse(await res.json());
}

// The internal rating page (PLAN.md M7): admins only, so every call is signed in.

/** The next pair of layouts to rate; null once every pair has been rated. */
export async function fetchNextPair(signal?: AbortSignal): Promise<RatingPair | null> {
  const res = await fetch('/api/admin/ratings/next', { headers: await signedIn(), signal });
  if (!res.ok) throw await failure(res, 'GET /api/admin/ratings/next');
  return NextPair.parse(await res.json()).pair;
}

/** Saves a rating; answers it, with what the scorer would have picked. */
export async function saveRating(input: RatingInput): Promise<RatingSaved> {
  const res = await fetch('/api/admin/ratings', {
    method: 'POST',
    headers: await signedIn({ 'content-type': 'application/json' }),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await failure(res, 'POST /api/admin/ratings');
  return RatingSaved.parse(await res.json());
}

/** Takes a rating back: it's kept, marked archived. */
export async function archiveRating(id: string): Promise<Rating> {
  const res = await fetch(`/api/admin/ratings/${id}/archive`, {
    method: 'POST',
    headers: await signedIn(),
  });
  if (!res.ok) throw await failure(res, 'POST /api/admin/ratings/:id/archive');
  return Rating.parse(await res.json());
}

export async function fetchRatingSummary(signal?: AbortSignal): Promise<RatingSummary> {
  const res = await fetch('/api/admin/ratings/summary', { headers: await signedIn(), signal });
  if (!res.ok) throw await failure(res, 'GET /api/admin/ratings/summary');
  return RatingSummary.parse(await res.json());
}

/** Has the rating's notes read into labels by the AI: a few seconds, a fraction of a cent. */
export async function readNotes(id: string): Promise<Rating> {
  const res = await fetch(`/api/admin/ratings/${id}/read`, {
    method: 'POST',
    headers: await signedIn(),
  });
  if (!res.ok) throw await failure(res, 'POST /api/admin/ratings/:id/read');
  return Rating.parse(await res.json());
}

/** Saves the rater's corrections to how their notes were read. */
export async function saveLabels(id: string, labels: readonly NoteLabel[]): Promise<Rating> {
  const res = await fetch(`/api/admin/ratings/${id}/labels`, {
    method: 'PUT',
    headers: await signedIn({ 'content-type': 'application/json' }),
    body: JSON.stringify({ labels }),
  });
  if (!res.ok) throw await failure(res, 'PUT /api/admin/ratings/:id/labels');
  return Rating.parse(await res.json());
}
