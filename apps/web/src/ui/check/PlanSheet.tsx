import { bounds, interiorPoint } from '@roomie/geometry';
import { FURNISHABLE, type Floorplan, type Vec2 } from '@roomie/schema';
import { useEffect, useMemo, useState } from 'react';
import { type PixelPlan, pixelPlan } from '../../check';

export type Highlight = {
  /** Fill and name every room; the one in `room` stands out. */
  rooms?: boolean;
  room?: string;
  /** One wall, drawn in blue with its length: the wall the size question asks about. */
  wall?: { id: string; label: string };
  /** Doors and windows, coloured. */
  openings?: boolean;
  /** Rooms, walls or openings to zoom to: a thing to check. */
  focus?: readonly string[];
};

type Props = { plan: Floorplan; imageUrl: string | undefined; highlight: Highlight; label: string };

const DOOR = '#2563a6';
const WINDOW = '#d18a1e';

/**
 * The plan as a sheet to look at, never to edit (§4.3): the uploaded image under what we read
 * from it, with the parts the current question is about picked out.
 */
export function PlanSheet({ plan, imageUrl, highlight, label }: Props) {
  const px = useMemo(() => pixelPlan(plan), [plan]);
  const size = useImageSize(imageUrl, plan);
  const frame = useMemo(() => frameOf(px, size, highlight.focus), [px, size, highlight.focus]);
  const openings = useMemo(() => openingSegments(plan, px), [plan, px]);
  const stroke = frame.w / 300;

  return (
    <svg
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      role="img"
      aria-label={label}
      className="h-full w-full transition-[viewBox] duration-500"
      preserveAspectRatio="xMidYMid meet"
    >
      {imageUrl && size && (
        <image href={imageUrl} width={size.w} height={size.h} opacity={highlight.rooms ? 0.35 : 0.6} />
      )}
      {highlight.rooms &&
        px.rooms.map((r) => {
          const furnished = r.roomType !== undefined && FURNISHABLE.has(r.roomType);
          const picked = highlight.room === r.id;
          return (
            <polygon
              key={r.id}
              points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={picked ? '#1d4ed8' : furnished ? '#dbe4fb' : '#ecebe6'}
              fillOpacity={picked ? 0.35 : 0.85}
            />
          );
        })}
      {px.walls.map((w) => (
        <line
          key={w.id}
          x1={w.a.x}
          y1={w.a.y}
          x2={w.b.x}
          y2={w.b.y}
          stroke="#1c1c1a"
          strokeWidth={Math.max(w.thickness, stroke * 1.5)}
          strokeLinecap="square"
        />
      ))}
      {highlight.openings &&
        openings.map((o) => (
          <line
            key={o.id}
            x1={o.a.x}
            y1={o.a.y}
            x2={o.b.x}
            y2={o.b.y}
            stroke={o.kind === 'window' ? WINDOW : DOOR}
            strokeWidth={Math.max(o.thickness * 1.4, stroke * 4)}
            strokeDasharray={o.kind === 'passage' ? `${stroke * 3} ${stroke * 2}` : undefined}
          />
        ))}
      {highlight.wall && <WallMark px={px} {...highlight.wall} stroke={stroke} />}
      {highlight.focus?.map((id) => <FocusMark key={id} id={id} px={px} openings={openings} stroke={stroke} />)}
      {highlight.rooms &&
        px.rooms.map((r) => {
          const at = interiorPoint(r.polygon);
          return (
            <text
              key={r.id}
              x={at.x}
              y={at.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="IBM Plex Mono, monospace"
              fontWeight={600}
              fontSize={frame.w / 45}
              fill="#1c1c1a"
              stroke="#ffffff"
              strokeWidth={stroke * 1.5}
              paintOrder="stroke"
            >
              {r.name}
            </text>
          );
        })}
    </svg>
  );
}

function WallMark({ px, id, label, stroke }: { px: PixelPlan; id: string; label: string; stroke: number }) {
  const wall = px.walls.find((w) => w.id === id);
  if (!wall) return null;
  const mid = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
  // The label goes on the side of the wall towards the middle of the plan, so it's never cut off.
  const centre = bounds(px.walls.flatMap((w) => [w.a, w.b]));
  const toward = {
    x: (centre.min.x + centre.max.x) / 2 - mid.x,
    y: (centre.min.y + centre.max.y) / 2 - mid.y,
  };
  const reach = Math.hypot(toward.x, toward.y) || 1;
  const at = { x: mid.x + (toward.x / reach) * stroke * 16, y: mid.y + (toward.y / reach) * stroke * 16 };
  return (
    <g>
      <line
        x1={wall.a.x}
        y1={wall.a.y}
        x2={wall.b.x}
        y2={wall.b.y}
        stroke="#1d4ed8"
        strokeWidth={Math.max(wall.thickness * 1.6, stroke * 5)}
        strokeLinecap="square"
      />
      <text
        x={at.x}
        y={at.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="IBM Plex Mono, monospace"
        fontWeight={600}
        fontSize={stroke * 9}
        fill="#1e3a8a"
        stroke="#ffffff"
        strokeWidth={stroke * 2}
        paintOrder="stroke"
      >
        {label}
      </text>
    </g>
  );
}

function FocusMark(props: {
  id: string;
  px: PixelPlan;
  openings: OpeningSegment[];
  stroke: number;
}) {
  const points = pointsOf(props.id, props.px, props.openings);
  if (points.length === 0) return null;
  const { min, max } = bounds(points);
  const pad = props.stroke * 8;
  return (
    <rect
      x={min.x - pad}
      y={min.y - pad}
      width={max.x - min.x + 2 * pad}
      height={max.y - min.y + 2 * pad}
      fill="none"
      stroke="#1d4ed8"
      strokeWidth={props.stroke * 2}
      strokeDasharray={`${props.stroke * 5} ${props.stroke * 4}`}
    />
  );
}

type OpeningSegment = { id: string; kind: string; a: Vec2; b: Vec2; thickness: number };

/** Doors and windows as segments along their walls, in image pixels. */
function openingSegments(plan: Floorplan, px: PixelPlan): OpeningSegment[] {
  const mpp = plan.scale?.metersPerPixel;
  const openings = mpp ? plan.openings : (plan.reading?.draft.openings ?? []);
  const toPx = mpp ? 1 / mpp : 1;
  const walls = new Map(px.walls.map((w) => [w.id, w]));
  return openings.flatMap((o) => {
    const wall = walls.get(o.wallId);
    if (!wall) return [];
    const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) || 1;
    const along = (t: number) => ({
      x: wall.a.x + ((wall.b.x - wall.a.x) * t) / len,
      y: wall.a.y + ((wall.b.y - wall.a.y) * t) / len,
    });
    const start = o.offset * toPx;
    return [
      { id: o.id, kind: o.kind, a: along(start), b: along(start + o.width * toPx), thickness: wall.thickness },
    ];
  });
}

function pointsOf(id: string, px: PixelPlan, openings: OpeningSegment[]): Vec2[] {
  const room = px.rooms.find((r) => r.id === id);
  if (room) return room.polygon;
  const wall = px.walls.find((w) => w.id === id);
  if (wall) return [wall.a, wall.b];
  const opening = openings.find((o) => o.id === id);
  return opening ? [opening.a, opening.b] : [];
}

type Frame = { x: number; y: number; w: number; h: number };

/** The part of the sheet to show: the whole plan, or a close-up of what to check. */
function frameOf(px: PixelPlan, size: { w: number; h: number } | undefined, focus?: readonly string[]): Frame {
  const drawn = [...px.walls.flatMap((w) => [w.a, w.b]), ...px.rooms.flatMap((r) => r.polygon)];
  const focused = focus?.flatMap((id) => pointsOf(id, px, [])) ?? [];
  const points = focused.length > 0 ? focused : drawn;
  if (points.length === 0) return { x: 0, y: 0, w: size?.w ?? 100, h: size?.h ?? 100 };
  const { min, max } = bounds(points);
  const span = Math.max(max.x - min.x, max.y - min.y, 1);
  const pad = span * (focused.length > 0 ? 0.6 : 0.06);
  return { x: min.x - pad, y: min.y - pad, w: max.x - min.x + 2 * pad, h: max.y - min.y + 2 * pad };
}

/** The image's own size: from the plan when it has one, else as the browser loads it (the demo). */
function useImageSize(url: string | undefined, plan: Floorplan): { w: number; h: number } | undefined {
  const image = plan.image;
  const known = useMemo(() => image && { w: image.width, h: image.height }, [image]);
  const [loaded, setLoaded] = useState<{ url: string; w: number; h: number }>();
  useEffect(() => {
    if (known || !url) return;
    const img = new Image();
    img.onload = () => setLoaded({ url, w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [url, known]);
  return known ?? (loaded?.url === url ? loaded : undefined);
}
