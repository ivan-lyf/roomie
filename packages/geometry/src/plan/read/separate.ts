import type { RawPlan, Vec2 } from '@roomie/schema';
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { labelTokens } from '../labels';
import { area, contains, simplify } from '../polygon';

// A reader often draws a room's box straight over a smaller room inside it (a WC in the corner
// of a hall), or two rooms that disagree about where the wall between them is. Their outlines
// are cut apart here, in image pixels, before the rooms are typed and sized.

type DraftRoom = { polygon: Vec2[]; label?: string };

/** Overlaps smaller than this, in square pixels, are rooms sharing an edge. */
const SLIVER = 1;

const toPolygon = (points: readonly Vec2[]): Polygon => [points.map((p) => [p.x, p.y])];
/** The outer ring of a result, without its closing point. */
const ring = (polygon: Polygon): Vec2[] => polygon[0]!.slice(0, -1).map(([x, y]) => ({ x, y }));

const center = (box: { x: number; y: number; w: number; h: number }): Vec2 => ({
  x: box.x + box.w / 2,
  y: box.y + box.h / 2,
});

/** Where a room's own label is: text inside it whose words are all in what the reader called it. */
function labelPoints(room: DraftRoom, texts: RawPlan['texts']): Vec2[] {
  if (!room.label) return [];
  const words = new Set(labelTokens(room.label));
  return texts
    .filter((t) => {
      const tokens = labelTokens(t.text);
      return tokens.length > 0 && tokens.every((w) => words.has(w));
    })
    .map((t) => center(t.bbox))
    .filter((p) => contains(room.polygon, p));
}

const holdsAny = (polygon: readonly Vec2[], points: readonly Vec2[]) =>
  points.some((p) => contains(polygon, p));

/**
 * Cuts overlapping rooms apart. Where two overlap, the room whose label is in the overlap keeps
 * it, else the smaller room; the other loses it. A room cut in pieces keeps the piece with its
 * label, else the largest, and pieces smaller than `minArea` are dropped. A room left with
 * nothing is dropped, and a cut that would leave a hole (one room wholly inside another,
 * touching none of its walls) isn't made: that one is the user's to fix.
 */
export function separateRooms<R extends DraftRoom>(
  rooms: readonly R[],
  texts: RawPlan['texts'],
  minArea: number,
): R[] {
  const out: (R | undefined)[] = rooms.map((r) => ({ ...r }));
  const labels = rooms.map((r) => labelPoints(r, texts));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const [a, b] = [out[i], out[j]];
      if (!a || !b) continue;
      const shared = polygonClipping.intersection(toPolygon(a.polygon), toPolygon(b.polygon));
      const overlap = shared.reduce((s, p) => s + area(ring(p)), 0);
      // Any overlap is cut, however thin: the plan's checks catch rooms 5 cm into each other.
      if (overlap < SLIVER) continue;

      const inOverlap = (k: number) => shared.some((p) => holdsAny(ring(p), labels[k]!));
      const [aHere, bHere] = [inOverlap(i), inOverlap(j)];
      const aKeeps = aHere !== bHere ? aHere : area(a.polygon) <= area(b.polygon);
      const [keeper, loser, k] = aKeeps ? [a, b, j] : [b, a, i];

      const left: MultiPolygon = polygonClipping
        .difference(toPolygon(loser.polygon), toPolygon(keeper.polygon))
        .filter((p) => area(ring(p)) >= minArea);
      if (left.length === 0) {
        out[k] = undefined;
        continue;
      }
      const piece =
        left.find((p) => holdsAny(ring(p), labels[k]!)) ??
        left.toSorted((p, q) => area(ring(q)) - area(ring(p)))[0]!;
      if (piece.some((hole, n) => n > 0 && area(ring([hole])) >= minArea)) continue;
      out[k] = { ...loser, polygon: simplify(ring(piece), 1.5) };
    }
  }
  return out.filter((r): r is R => r !== undefined && r.polygon.length >= 3);
}
