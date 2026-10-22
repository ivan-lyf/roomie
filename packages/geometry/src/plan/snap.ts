import type { Vec2 } from '@roomie/schema';

export type Segment = { a: Vec2; b: Vec2 };

export type Snap = { point: Vec2; to: 'point' | 'segment' | 'angle' | 'angle_segment' | 'none' };

export type SnapTargets = {
  /** Wall ends, room corners: a point near one of them becomes it. */
  points: readonly Vec2[];
  /** Walls: a point near one lands on it. */
  segments: readonly Segment[];
  /** The previous point while drawing: the new one keeps to multiples of `angleStep` from it. */
  from?: Vec2;
  /** How close counts as near, in plan meters (the caller converts screen pixels). */
  tolerance: number;
  angleStep?: number;
};

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The closest point to `p` on a segment, and how far along it that is (0 at `a`, 1 at `b`). */
export function closestOnSegment(p: Vec2, s: Segment): { point: Vec2; t: number } {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  const raw = len2 === 0 ? 0 : ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2;
  const t = Math.min(1, Math.max(0, raw));
  return { point: { x: s.a.x + dx * t, y: s.a.y + dy * t }, t };
}

/** Where the line through `p` and `q` crosses a segment, if it does. */
function lineSegment(p: Vec2, q: Vec2, s: Segment): Vec2 | undefined {
  const r = { x: q.x - p.x, y: q.y - p.y };
  const e = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
  const denom = r.x * e.y - r.y * e.x;
  if (Math.abs(denom) < 1e-12) return undefined;
  const u = ((s.a.x - p.x) * r.y - (s.a.y - p.y) * r.x) / denom;
  if (u < 0 || u > 1) return undefined;
  return { x: s.a.x + e.x * u, y: s.a.y + e.y * u };
}

/**
 * Snaps a point being drawn or dragged: onto a nearby point first, then onto the line from `from`
 * at a multiple of `angleStep` (90° by default), then onto a nearby segment; where the angle line
 * crosses a nearby segment, onto that crossing.
 */
export function snapPoint(p: Vec2, targets: SnapTargets): Snap {
  const { tolerance } = targets;
  let nearest: Vec2 | undefined;
  for (const q of targets.points) {
    if (distance(p, q) <= tolerance && (!nearest || distance(p, q) < distance(p, nearest))) {
      nearest = q;
    }
  }
  if (nearest) return { point: { ...nearest }, to: 'point' };

  let angled: Vec2 | undefined;
  const from = targets.from;
  if (from && distance(p, from) > tolerance) {
    const step = targets.angleStep ?? Math.PI / 2;
    const angle = Math.atan2(p.y - from.y, p.x - from.x);
    const snapped = Math.round(angle / step) * step;
    const along = distance(p, from) * Math.cos(angle - snapped);
    const q = { x: from.x + Math.cos(snapped) * along, y: from.y + Math.sin(snapped) * along };
    if (distance(p, q) <= tolerance) angled = q;
  }

  let onSegment: { point: Vec2; segment: Segment } | undefined;
  for (const segment of targets.segments) {
    const { point } = closestOnSegment(p, segment);
    const d = distance(p, point);
    if (d <= tolerance && (!onSegment || d < distance(p, onSegment.point))) {
      onSegment = { point, segment };
    }
  }

  if (angled && from && onSegment) {
    const crossing = lineSegment(from, angled, onSegment.segment);
    if (crossing && distance(p, crossing) <= tolerance * 1.5) {
      return { point: crossing, to: 'angle_segment' };
    }
  }
  if (angled) return { point: angled, to: 'angle' };
  if (onSegment) return { point: onSegment.point, to: 'segment' };
  return { point: { ...p }, to: 'none' };
}
