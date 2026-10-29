import { bounds, pointAlong, roomAt, roomContext, roomsBeside } from '@roomie/geometry';
import { FURNISHABLE, type Floorplan, type Room, type Vec2 } from '@roomie/schema';

// The home in words, for the LLM that furnishes it: each room's size, and what's along each wall
// as seen from inside, by compass side (north is up the plan).

const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const m = (v: number) => `${v.toFixed(2)} m`;

/** A direction on the plan as a compass point: up the page is north. */
export function compass(v: Vec2): string {
  const angle = (Math.atan2(v.x, -v.y) * 180) / Math.PI;
  const names = [
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
  ];
  return names[(Math.round(angle / 45) + 8) % 8]!;
}

const furnishable = (room: Room) => room.furnishable && FURNISHABLE.has(room.roomType);

/** One room, as the LLM is told about it. */
export function describeRoom(plan: Floorplan, room: Room): string {
  const ctx = roomContext(plan, room.id)!;
  const { min, max } = bounds(ctx.floor);
  const shape = ctx.floor.length === 4 ? '' : `, ${ctx.floor.length} corners (not a rectangle)`;
  const lines = [
    `Room ${room.id}: ${room.name} (${room.roomType}), ${m(max.x - min.x)} east-west × ` +
      `${m(max.y - min.y)} north-south inside, ${ctx.area.toFixed(1)} m²${shape}.`,
  ];

  const doors = plan.openings.filter((o) => o.kind !== 'window');
  for (const face of ctx.faces) {
    const side = compass({ x: -face.inward.x, y: -face.inward.y });
    const from = compass({ x: -face.d.x, y: -face.d.y });
    const notes: string[] = face.windows.map(
      (w) => `window ${m(w.to - w.from)} wide at ${m(w.from)}–${m(w.to)}`,
    );
    for (const o of doors) {
      const wall = plan.walls.find((w) => w.id === o.wallId)!;
      const ends = [o.offset, o.offset + o.width].map((t) => pointAlong(wall, t));
      const mid = { x: (ends[0]!.x + ends[1]!.x) / 2, y: (ends[0]!.y + ends[1]!.y) / 2 };
      const rel = { x: mid.x - face.p.x, y: mid.y - face.p.y };
      if (Math.abs(dot(rel, face.inward)) > wall.thickness / 2 + 0.05) continue;
      const along = ends
        .map((e) => dot({ x: e.x - face.p.x, y: e.y - face.p.y }, face.d))
        .sort((a, b) => a - b);
      if (along[1]! < 0 || along[0]! > face.length) continue;
      const beside = roomsBeside(wall, o.offset + o.width / 2, plan.rooms);
      const other = [beside.left, beside.right].find((r) => r && r.id !== room.id);
      const to = other ? `to ${other.name}` : 'out of the home';
      const kind = o.kind === 'passage' ? 'open doorway' : 'door';
      notes.push(
        `${kind} ${m(o.width)} wide ${to} at ` +
          `${m(Math.max(0, along[0]!))}–${m(Math.min(face.length, along[1]!))}`,
      );
    }
    const what = notes.length > 0 ? `: ${notes.join('; ')}` : ', plain';
    lines.push(`- ${side} wall, ${m(face.length)} long (measured from its ${from} end)${what}.`);
  }

  // Sides with no wall, open to the next room.
  for (const strip of ctx.beyond) {
    const [p, q] = [strip[0]!, strip[1]!];
    const outward = { x: strip[3]!.x - p.x, y: strip[3]!.y - p.y };
    const next = roomAt(
      plan.rooms.filter((r) => r.id !== room.id),
      { x: (p.x + q.x) / 2 + outward.x / 6, y: (p.y + q.y) / 2 + outward.y / 6 },
    );
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    lines.push(
      `- ${compass(outward)} side, ${m(length)}: no wall, open to ${next?.name ?? 'the outside'}.`,
    );
  }

  for (const o of plan.obstacles) {
    const c = o.polygon.reduce(
      (s, p) => ({ x: s.x + p.x / o.polygon.length, y: s.y + p.y / o.polygon.length }),
      { x: 0, y: 0 },
    );
    if (roomAt([room], c)) {
      const b = bounds(o.polygon);
      lines.push(
        `- A built-in ${o.kind}, ${m(b.max.x - b.min.x)} × ${m(b.max.y - b.min.y)}, near the ` +
          `${compass({ x: c.x - ctx.center.x, y: c.y - ctx.center.y })} of the room.`,
      );
    }
  }
  return lines.join('\n');
}

/** The rooms to furnish in detail, and the others in a line, so the home's layout is clear. */
export function describeHome(plan: Floorplan, roomIds: readonly string[]): string {
  const furnish = plan.rooms.filter((r) => roomIds.includes(r.id) && furnishable(r));
  const others = plan.rooms.filter((r) => !furnish.includes(r));
  const parts = [
    `The home has ${plan.rooms.length} rooms, with ceilings ${m(plan.ceilingHeight)} high.`,
    'Rooms to furnish:',
    ...furnish.map((r) => describeRoom(plan, r)),
  ];
  if (others.length > 0) {
    parts.push(
      `Other rooms, left as they are: ` +
        `${others.map((r) => `${r.name} (${r.roomType})`).join(', ')}.`,
    );
  }
  return parts.join('\n\n');
}
