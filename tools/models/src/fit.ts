import type { Category, Dims, ProductShape } from '@roomie/schema';
import { fitScale, type Vec3 } from './normalize';

/** Categories with no front, where a quarter turn is fine when it fits the listed size better. */
const TURNABLE: ReadonlySet<Category> = new Set([
  'rug',
  'coffee_table',
  'dining_table',
  'floor_lamp',
]);
/** Categories whose listed height is often a default (RUG_THICKNESS), so it doesn't count. */
const LOOSE_HEIGHT: ReadonlySet<Category> = new Set(['rug']);
/** Categories whose tall part is at the back, so the facing check applies. */
export const BACKED: ReadonlySet<Category> = new Set([
  'sofa',
  'armchair',
  'dining_chair',
  'desk_chair',
  'bed',
]);

type FitTarget = { category: Category; dims: Dims; shape: ProductShape };

/** The largest change of scale across the axes that count for the category. */
export function scaleChange(scale: Vec3, category: Category): number {
  const axes = LOOSE_HEIGHT.has(category) ? [scale[0], scale[2]] : scale;
  return Math.max(...axes.map((s) => Math.abs(s - 1)));
}

/** A quarter turn when the category allows one and it fits a model of `size` better, else 0. */
export function chooseYaw(size: Vec3, product: FitTarget): number {
  if (!TURNABLE.has(product.category)) return 0;
  const change = (s: Vec3) =>
    scaleChange(fitScale(s, product.dims, product.shape === 'round'), product.category);
  return change([size[2], size[1], size[0]]) < change(size) ? Math.PI / 2 : 0;
}

export type Donor = { itemNo: string; rawSize: Vec3 };

/**
 * The sibling variant whose IKEA model best fits a product's listed size (another color fits
 * exactly, another size gets rescaled), within `maxChange`. Ties go to the lowest item number.
 */
export function pickDonor(
  product: FitTarget,
  donors: readonly Donor[],
  maxChange: number,
): (Donor & { change: number }) | undefined {
  let best: (Donor & { change: number }) | undefined;
  for (const donor of donors) {
    const [x, y, z] = donor.rawSize;
    const size: Vec3 = chooseYaw(donor.rawSize, product) ? [z, y, x] : donor.rawSize;
    const change = scaleChange(
      fitScale(size, product.dims, product.shape === 'round'),
      product.category,
    );
    if (change > maxChange) continue;
    if (!best || change < best.change || (change === best.change && donor.itemNo < best.itemNo)) {
      best = { ...donor, change };
    }
  }
  return best;
}
