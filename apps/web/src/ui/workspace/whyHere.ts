import type { HomeFurnishing, Placement } from '@roomie/schema';
import { whyOf } from '../../furnishing';

/** Further than this from where it was furnished, an item counts as moved by the user. */
const MOVED = 0.02;

/**
 * "Why here?" for an item (§4.6): the reason it was chosen, while it stands where it was put;
 * "You placed this." once moved or placed by hand; nothing when there's nothing to say.
 */
export function whyHere(
  item: Placement,
  furnishing: HomeFurnishing | undefined,
): string | undefined {
  const planned = furnishing?.rooms
    .find((r) => r.roomId === item.roomId)
    ?.placements.find((p) => p.id === item.id || (item.ref !== undefined && p.ref === item.ref));
  const moved =
    !planned || Math.hypot(planned.x - item.x, planned.y - item.y) > MOVED;
  if (!item.ref || moved) return furnishing ? 'You placed this.' : undefined;
  return whyOf(item, furnishing);
}
