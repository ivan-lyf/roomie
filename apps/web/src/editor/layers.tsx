import { area, centroid, doorSwing, pointAlong, wallLength } from '@roomie/geometry';
import type { Floorplan, Opening, RoomType, Vec2, Wall } from '@roomie/schema';
import { Circle, Group, Line, Rect, Shape, Text } from 'react-konva';
import { squareMeters } from '../format';

// The plan's layers, drawn in plan meters. `px` is one screen pixel in meters, so strokes and
// text keep their size on screen at any zoom. Each shape names what it is (`kind`) and which
// element (`elementId`), for the canvas to tell what was clicked.

const ROOM_COLORS: Record<RoomType, string> = {
  living_room: '#f59e0b',
  bedroom: '#3b82f6',
  studio: '#8b5cf6',
  dining_area: '#f97316',
  den_office: '#14b8a6',
  kitchen: '#84cc16',
  bathroom: '#06b6d4',
  hallway: '#a8a29e',
  closet: '#78716c',
  laundry: '#0ea5e9',
  balcony: '#22c55e',
  other: '#d6d3d1',
};

const SELECTED = '#e11d48';
const WALL = '#292524';
const flat = (points: readonly Vec2[]) => points.flatMap((p) => [p.x, p.y]);

type LayerProps = { plan: Floorplan; selection: readonly string[]; px: number; listening: boolean };

export function Rooms({ plan, selection, px, listening }: LayerProps) {
  return (
    <Group listening={listening}>
      {plan.rooms.map((room) => {
        const selected = selection.includes(room.id);
        const c = centroid(room.boundary);
        const color = ROOM_COLORS[room.roomType];
        return (
          <Group key={room.id}>
            <Line
              points={flat(room.boundary)}
              closed
              fill={color}
              opacity={selected ? 0.4 : 0.22}
              stroke={selected ? SELECTED : color}
              strokeWidth={(selected ? 2 : 1) * px}
              kind="room"
              elementId={room.id}
            />
            <Text
              x={c.x - 80 * px}
              y={c.y - 14 * px}
              width={160 * px}
              align="center"
              text={`${room.name}\n${squareMeters(area(room.boundary))}`}
              fontSize={12 * px}
              lineHeight={1.3}
              fill="#1c1917"
              listening={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}

export function Obstacles({ plan, selection, px, listening }: LayerProps) {
  return (
    <Group listening={listening}>
      {plan.obstacles.map((o) => {
        const selected = selection.includes(o.id);
        return (
          <Line
            key={o.id}
            points={flat(o.polygon)}
            closed
            fill="#57534e"
            opacity={selected ? 0.55 : 0.35}
            stroke={selected ? SELECTED : '#44403c'}
            strokeWidth={(selected ? 2 : 1) * px}
            kind="obstacle"
            elementId={o.id}
          />
        );
      })}
    </Group>
  );
}

export function Walls({ plan, selection, px, listening }: LayerProps) {
  return (
    <Group listening={listening}>
      {plan.walls.map((w) => (
        <Line
          key={w.id}
          points={flat([w.a, w.b])}
          stroke={selection.includes(w.id) ? SELECTED : WALL}
          strokeWidth={w.thickness}
          hitStrokeWidth={Math.max(w.thickness, 12 * px)}
          lineCap="square"
          opacity={0.85}
          kind="wall"
          elementId={w.id}
        />
      ))}
    </Group>
  );
}

export function Openings({ plan, selection, px, listening }: LayerProps) {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  return (
    <Group listening={listening}>
      {plan.openings.map((o) => {
        const wall = walls.get(o.wallId);
        return wall ? (
          <OpeningShape
            key={o.id}
            wall={wall}
            opening={o}
            selected={selection.includes(o.id)}
            px={px}
          />
        ) : null;
      })}
    </Group>
  );
}

function OpeningShape(props: { wall: Wall; opening: Opening; selected: boolean; px: number }) {
  const { wall, opening: o, selected, px } = props;
  const start = pointAlong(wall, o.offset);
  const end = pointAlong(wall, o.offset + o.width);
  const color = selected ? SELECTED : o.kind === 'window' ? '#0284c7' : '#57534e';
  const swing = doorSwing(wall, o);
  return (
    <Group>
      {/* The gap in the wall, which is also what's clicked. */}
      <Line
        points={flat([start, end])}
        stroke="#fafaf9"
        strokeWidth={wall.thickness * 1.05}
        hitStrokeWidth={Math.max(wall.thickness, 12 * px)}
        kind="opening"
        elementId={o.id}
      />
      {o.kind === 'window' && (
        <Line points={flat([start, end])} stroke={color} strokeWidth={2 * px} listening={false} />
      )}
      {o.kind === 'passage' && (
        <Line
          points={flat([start, end])}
          stroke={color}
          strokeWidth={1.5 * px}
          dash={[4 * px, 3 * px]}
          listening={false}
        />
      )}
      {swing && (
        <Shape
          listening={false}
          stroke={color}
          strokeWidth={1.5 * px}
          sceneFunc={(ctx, shape) => {
            const { hinge, closed, open, radius } = swing;
            const a0 = Math.atan2(closed.y, closed.x);
            const a1 = Math.atan2(open.y, open.x);
            const sweep = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
            ctx.beginPath();
            ctx.moveTo(hinge.x + open.x * radius, hinge.y + open.y * radius);
            ctx.lineTo(hinge.x, hinge.y);
            ctx.moveTo(hinge.x + closed.x * radius, hinge.y + closed.y * radius);
            ctx.arc(hinge.x, hinge.y, radius, a0, a1, sweep < 0);
            ctx.strokeShape(shape);
          }}
        />
      )}
    </Group>
  );
}

/** Handles to drag: wall ends, and the corners of selected rooms and obstacles. */
export function Handles({ plan, selection, px }: Omit<LayerProps, 'listening'>) {
  const points: Vec2[] = [];
  const add = (p: Vec2) => {
    if (points.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 1e-3)) points.push(p);
  };
  for (const w of plan.walls) [w.a, w.b].forEach(add);
  for (const r of plan.rooms) if (selection.includes(r.id)) r.boundary.forEach(add);
  for (const o of plan.obstacles) if (selection.includes(o.id)) o.polygon.forEach(add);
  const ends = plan.openings
    .filter((o) => selection.includes(o.id))
    .flatMap((o) => {
      const wall = plan.walls.find((w) => w.id === o.wallId);
      if (!wall) return [];
      const at = (d: number) => pointAlong(wall, Math.min(d, wallLength(wall)));
      return [
        { id: o.id, end: 'start', p: at(o.offset) },
        { id: o.id, end: 'end', p: at(o.offset + o.width) },
      ];
    });
  return (
    <Group>
      {points.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={4 * px}
          hitStrokeWidth={8 * px}
          fill="#fff"
          stroke={WALL}
          strokeWidth={1.5 * px}
          kind="point"
          point={p}
        />
      ))}
      {ends.map(({ id, end, p }) => (
        <Rect
          key={`${id}-${end}`}
          x={p.x - 4 * px}
          y={p.y - 4 * px}
          width={8 * px}
          height={8 * px}
          fill="#fff"
          stroke={SELECTED}
          strokeWidth={1.5 * px}
          kind="opening-end"
          elementId={id}
          end={end}
        />
      ))}
    </Group>
  );
}
