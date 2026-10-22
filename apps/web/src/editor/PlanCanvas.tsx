import {
  checkRoomLabels,
  contains,
  distance,
  moveWall,
  movePoint,
  nearestWall,
  pointAlong,
  SAME_POINT,
  snapPoint,
  wallLength,
  type Snap,
} from '@roomie/geometry';
import type { Floorplan, PlanDraft, Vec2 } from '@roomie/schema';
import type Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Image, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { formatLength } from '../format';
import { OPENING_WIDTHS, useFloorplan } from '../stores/floorplan';
import { useEditor } from '../stores/editor';
import { Handles, Obstacles, Openings, Rooms, Walls } from './layers';
import { canvasSize, fitView, toPixels, zoomAt, type View } from './view';

/** Snapping reaches this far, in screen pixels. */
const SNAP_PX = 8;
/** A press that moves less than this is a click. */
const CLICK_PX = 4;

type Gesture =
  | { type: 'press'; screen: Vec2; view: View; panning: boolean; target?: Target }
  | { type: 'point'; from: Vec2; to: Vec2; anchor?: Vec2 }
  | { type: 'wall'; wallId: string; start: Vec2; delta: Vec2 }
  | { type: 'opening'; id: string; grab: number; offset: number }
  | { type: 'opening-end'; id: string; end: 'start' | 'end'; offset: number; width: number }
  | { type: 'rect'; start: Vec2; end: Vec2 };

/** What a press landed on, from the shape's `kind` and `elementId` attributes. */
type Target = { kind: string; id?: string; point?: Vec2; end?: 'start' | 'end' };

function targetOf(node: Konva.Node): Target | undefined {
  const kind = node.getAttr('kind') as string | undefined;
  if (!kind) return undefined;
  return {
    kind,
    id: node.getAttr('elementId') as string | undefined,
    point: node.getAttr('point') as Vec2 | undefined,
    end: node.getAttr('end') as 'start' | 'end' | undefined,
  };
}

/** The plan image, once loaded. */
function useImage(src: string | undefined) {
  const [image, setImage] = useState<HTMLImageElement>();
  useEffect(() => {
    if (!src) return;
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);
  return src ? image : undefined;
}

export function PlanCanvas({ plan, imageUrl }: { plan: Floorplan; imageUrl?: string }) {
  const store = useFloorplan.getState();
  const { tool, selection, draft, imperial, wallThickness, obstacleKind, method, measure } =
    useEditor();
  const editor = useEditor.getState();
  const image = useImage(imageUrl);
  const box = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>();
  const [gesture, setGesture] = useState<Gesture>();
  const [cursor, setCursor] = useState<{ px: Vec2; snap?: Snap; shift: boolean }>();
  const [message, setMessage] = useState<string>();

  const mpp = plan.scale?.metersPerPixel;
  const size = canvasSize(plan);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setViewport({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fit the drawing once the viewport has a size; "Fit" in the toolbar does it again.
  const fitted = view ?? (viewport.width > 0 ? fitView(size, viewport) : undefined);
  useEffect(() => {
    const onFit = () => setView(fitView(size, viewport));
    window.addEventListener('editor:fit', onFit);
    return () => window.removeEventListener('editor:fit', onFit);
  }, [size.width, size.height, viewport]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(undefined), 3000);
    return () => clearTimeout(t);
  }, [message]);

  // What's on screen: the plan, with the drag in progress applied.
  const shown = useMemo(() => {
    if (!gesture) return plan;
    if (gesture.type === 'point') return movePoint(plan, gesture.from, gesture.to);
    if (gesture.type === 'wall') return moveWall(plan, gesture.wallId, gesture.delta);
    if (gesture.type === 'opening' || gesture.type === 'opening-end') {
      const width = gesture.type === 'opening-end' ? gesture.width : undefined;
      return {
        ...plan,
        openings: plan.openings.map((o) =>
          o.id === gesture.id ? { ...o, offset: gesture.offset, width: width ?? o.width } : o,
        ),
      };
    }
    return plan;
  }, [plan, gesture]);

  const flagged = useMemo(
    () => new Set(checkRoomLabels(plan).flatMap((c) => (c.agrees ? [] : [c.labelId]))),
    [plan],
  );

  if (!fitted) return <div ref={box} className="h-full w-full" />;
  const v = fitted;
  /** One screen pixel, in meters. */
  const px = (mpp ?? 1) / v.zoom;
  const tolerance = SNAP_PX * px;
  const toMeters = (p: Vec2): Vec2 => ({ x: p.x * (mpp ?? 1), y: p.y * (mpp ?? 1) });

  const snapTargets = (exclude?: Vec2) => {
    const keep = (p: Vec2) => !exclude || distance(p, exclude) > SAME_POINT;
    return {
      points: [
        ...plan.walls.flatMap((w) => [w.a, w.b]),
        ...plan.rooms.flatMap((r) => r.boundary),
        ...draft,
      ].filter(keep),
      segments: plan.walls.filter((w) => keep(w.a) && keep(w.b)),
      tolerance,
    };
  };
  const snapped = (p: Vec2, shift: boolean, from?: Vec2, exclude?: Vec2): Snap =>
    shift ? { point: p, to: 'none' } : snapPoint(p, { ...snapTargets(exclude), from });

  const pointer = (stage: Konva.Stage | null): Vec2 | undefined => {
    const p = stage?.getPointerPosition();
    return p ? { x: p.x, y: p.y } : undefined;
  };

  // What the measuring tool draws next: a line, or an outline.
  const measuring =
    method === 'wall_length' ? 'line' : method === 'area' || !measure.outline ? 'outline' : 'line';

  /** A click with the current tool, at a point in meters (and image pixels). */
  const click = (m: Vec2, pixels: Vec2, shift: boolean, target?: Target, toggle = false) => {
    const last = draft.at(-1);
    switch (tool) {
      case 'select': {
        const id = target?.id;
        if (!id) return editor.select([]);
        return toggle ? editor.toggle(id) : editor.select([id]);
      }
      case 'wall': {
        const s = snapped(m, shift, last).point;
        if (!last) return editor.setDraft([s]);
        if (distance(s, last) < SAME_POINT) return editor.setDraft([]);
        store.addWall(last, s, wallThickness);
        const closed = draft.length > 1 && distance(s, draft[0]!) < SAME_POINT;
        return editor.setDraft(closed ? [] : [...draft, s]);
      }
      case 'room': {
        const s = snapped(m, shift, last).point;
        if (draft.length >= 3 && distance(s, draft[0]!) <= tolerance) {
          const roomId = store.addRoom(draft);
          editor.select([roomId]);
          return editor.setDraft([]);
        }
        return editor.setDraft([...draft, s]);
      }
      case 'split': {
        const s = snapped(m, shift, last).point;
        if (!last) return editor.setDraft([s]);
        editor.setDraft([]);
        const mid = { x: (last.x + s.x) / 2, y: (last.y + s.y) / 2 };
        const rooms = plan.rooms.toSorted(
          (a, b) => Number(contains(b.boundary, mid)) - Number(contains(a.boundary, mid)),
        );
        const room = rooms.find((r) => store.splitRoom(r.id, last, s));
        if (!room) setMessage('Draw the line across a room, from one side to the other.');
        return;
      }
      case 'door':
      case 'window':
      case 'passage': {
        const hit = nearestWall(plan.walls, m, tolerance * 1.5);
        if (!hit) return setMessage(`Click on a wall to put a ${tool} in it.`);
        const id = store.addOpening(tool, hit.wall.id, hit.along);
        if (id) editor.select([id]);
        return;
      }
      case 'measure': {
        const toPx = (p: Vec2) => ({ x: p.x / (mpp ?? 1), y: p.y / (mpp ?? 1) });
        // The reader's draft, waiting for a scale, is already in pixels.
        const pending = !mpp ? plan.reading?.draft : undefined;
        if (measuring === 'line') {
          const wall = target?.kind === 'wall' && plan.walls.find((w) => w.id === target.id);
          if (!last && wall && mpp)
            return editor.set({ measure: { ...measure, line: [toPx(wall.a), toPx(wall.b)] } });
          const drafted =
            target?.kind === 'draft-wall' && pending?.walls.find((w) => w.id === target.id);
          if (!last && drafted)
            return editor.set({ measure: { ...measure, line: [drafted.a, drafted.b] } });
          const s = mpp ? toPx(snapped(m, shift, last && toMeters(last)).point) : pixels;
          if (!last) return editor.setDraft([s]);
          editor.set({ measure: { ...measure, line: [last, s] } });
          return editor.setDraft([]);
        }
        const room = target?.kind === 'room' && plan.rooms.find((r) => r.id === target.id);
        if (draft.length === 0 && room && mpp) {
          return editor.set({ measure: { ...measure, outline: room.boundary.map(toPx) } });
        }
        const draftRoom =
          target?.kind === 'draft-room' && pending?.rooms.find((r) => r.id === target.id);
        if (draft.length === 0 && draftRoom) {
          return editor.set({ measure: { ...measure, outline: draftRoom.polygon } });
        }
        const s = mpp ? toPx(snapped(m, shift, last && toMeters(last)).point) : pixels;
        if (draft.length >= 3 && distance(s, draft[0]!) <= SNAP_PX / v.zoom) {
          editor.set({ measure: { ...measure, outline: draft } });
          return editor.setDraft([]);
        }
        return editor.setDraft([...draft, s]);
      }
      default:
    }
  };

  const onDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const screen = pointer(e.target.getStage());
    if (!screen) return;
    const target = targetOf(e.target);
    const middle = e.evt.button === 1;
    if (tool === 'select' && !middle && target) {
      const m = toMeters(toPixels(v, screen));
      if (target.kind === 'point' && target.point) {
        const from = target.point;
        const wall = plan.walls.find(
          (w) => distance(w.a, from) < SAME_POINT || distance(w.b, from) < SAME_POINT,
        );
        const anchor = wall && (distance(wall.a, from) < SAME_POINT ? wall.b : wall.a);
        return setGesture({ type: 'point', from, to: from, anchor });
      }
      const opening = plan.openings.find((o) => o.id === target.id);
      const wall = opening && plan.walls.find((w) => w.id === opening.wallId);
      if (target.kind === 'opening-end' && opening && target.end) {
        const { offset, width } = opening;
        return setGesture({ type: 'opening-end', id: opening.id, end: target.end, offset, width });
      }
      if (target.kind === 'opening' && opening && wall) {
        const along = nearestWall([wall], m, Infinity)!.along;
        editor.select([opening.id]);
        return setGesture({
          type: 'opening',
          id: opening.id,
          grab: along - opening.offset,
          offset: opening.offset,
        });
      }
      if (target.kind === 'wall' && target.id) {
        if (!selection.includes(target.id)) editor.select([target.id]);
        return setGesture({ type: 'wall', wallId: target.id, start: m, delta: { x: 0, y: 0 } });
      }
    }
    if (tool === 'obstacle' && !middle && mpp) {
      const m = snapped(toMeters(toPixels(v, screen)), e.evt.shiftKey).point;
      return setGesture({ type: 'rect', start: m, end: m });
    }
    setGesture({ type: 'press', screen, view: v, panning: middle, target });
  };

  const onMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const screen = pointer(e.target.getStage());
    if (!screen) return;
    const pixels = toPixels(v, screen);
    const m = toMeters(pixels);
    const shift = e.evt.shiftKey;
    const drawing = ['wall', 'room', 'split'].includes(tool) || (tool === 'measure' && mpp);
    const from = tool === 'measure' ? draft.at(-1) && toMeters(draft.at(-1)!) : draft.at(-1);
    setCursor({ px: pixels, shift, ...(drawing && { snap: snapped(m, shift, from) }) });
    if (!gesture) return;
    switch (gesture.type) {
      case 'press': {
        const moved = distance(screen, gesture.screen) > CLICK_PX;
        if (gesture.panning || moved) {
          setGesture({ ...gesture, panning: true });
          setView({
            ...gesture.view,
            x: gesture.view.x + screen.x - gesture.screen.x,
            y: gesture.view.y + screen.y - gesture.screen.y,
          });
        }
        return;
      }
      case 'point':
        return setGesture({
          ...gesture,
          to: snapped(m, shift, gesture.anchor, gesture.from).point,
        });
      case 'wall': {
        // A wall moves square to itself; along it, it would only slide over its own line.
        const wall = plan.walls.find((w) => w.id === gesture.wallId)!;
        const len = wallLength(wall) || 1;
        const n = { x: -(wall.b.y - wall.a.y) / len, y: (wall.b.x - wall.a.x) / len };
        const d = (m.x - gesture.start.x) * n.x + (m.y - gesture.start.y) * n.y;
        return setGesture({ ...gesture, delta: { x: n.x * d, y: n.y * d } });
      }
      case 'opening': {
        const o = plan.openings.find((x) => x.id === gesture.id)!;
        const wall = plan.walls.find((w) => w.id === o.wallId)!;
        const along = nearestWall([wall], m, Infinity)!.along;
        const offset = Math.min(Math.max(along - gesture.grab, 0), wallLength(wall) - o.width);
        return setGesture({ ...gesture, offset });
      }
      case 'opening-end': {
        const o = plan.openings.find((x) => x.id === gesture.id)!;
        const wall = plan.walls.find((w) => w.id === o.wallId)!;
        const along = Math.min(
          Math.max(nearestWall([wall], m, Infinity)!.along, 0),
          wallLength(wall),
        );
        const [start, end] =
          gesture.end === 'start' ? [along, o.offset + o.width] : [o.offset, along];
        const width = Math.max(end - start, 0.1);
        return setGesture({
          ...gesture,
          offset: gesture.end === 'start' ? end - width : start,
          width,
        });
      }
      case 'rect':
        return setGesture({ ...gesture, end: snapped(m, shift).point });
    }
  };

  const onUp = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const g = gesture;
    setGesture(undefined);
    if (!g) return;
    const screen = pointer(e.target.getStage());
    switch (g.type) {
      case 'press':
        if (!g.panning && screen) {
          const pixels = toPixels(v, screen);
          click(toMeters(pixels), pixels, e.evt.shiftKey, g.target, e.evt.shiftKey);
        }
        return;
      case 'point':
        if (distance(g.from, g.to) > 1e-6) store.movePoint(g.from, g.to);
        return;
      case 'wall':
        if (Math.hypot(g.delta.x, g.delta.y) > 1e-6) store.moveWall(g.wallId, g.delta);
        return;
      case 'opening': {
        const o = plan.openings.find((x) => x.id === g.id);
        if (o && o.offset !== g.offset) store.setOpening(g.id, { offset: g.offset });
        return;
      }
      case 'opening-end':
        store.setOpening(g.id, { offset: g.offset, width: g.width });
        return;
      case 'rect': {
        const [a, b] = [g.start, g.end];
        if (Math.abs(a.x - b.x) < 0.05 || Math.abs(a.y - b.y) < 0.05) return;
        const id = store.addObstacle(obstacleKind, [
          { x: a.x, y: a.y },
          { x: b.x, y: a.y },
          { x: b.x, y: b.y },
          { x: a.x, y: b.y },
        ]);
        editor.select([id]);
      }
    }
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const screen = pointer(e.target.getStage());
    if (screen) setView(zoomAt(v, screen, Math.pow(1.0015, -e.evt.deltaY)));
  };

  // Previews of what the tool would do next.
  const snap = cursor?.snap;
  const draftMeters = tool === 'measure' ? [] : draft;
  const nextPoint = snap?.point;
  const opening =
    cursor && mpp && (tool === 'door' || tool === 'window' || tool === 'passage')
      ? nearestWall(plan.walls, toMeters(cursor.px), tolerance * 1.5)
      : undefined;
  const rect = gesture?.type === 'rect' ? gesture : undefined;
  const panning = gesture?.type === 'press' && gesture.panning;
  const cursorStyle = panning ? 'grabbing' : tool === 'select' ? 'default' : 'crosshair';

  return (
    <div
      ref={box}
      className="relative h-full w-full overflow-hidden bg-stone-200"
      style={{ cursor: cursorStyle }}
    >
      <Stage
        width={viewport.width}
        height={viewport.height}
        x={v.x}
        y={v.y}
        scaleX={v.zoom}
        scaleY={v.zoom}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setCursor(undefined)}
        onWheel={onWheel}
        onContextMenu={(e) => e.evt.preventDefault()}
      >
        <Layer>
          <Rect width={size.width} height={size.height} fill="#fff" listening={false} />
          {image && (
            <Image
              image={image}
              width={size.width}
              height={size.height}
              listening={false}
              opacity={0.75}
            />
          )}
          {plan.labels.map((label) => (
            <Rect
              key={label.id}
              {...label.bbox}
              width={label.bbox.w}
              height={label.bbox.h}
              stroke={flagged.has(label.id) ? '#dc2626' : '#2563eb'}
              strokeWidth={(flagged.has(label.id) ? 2 : 1) / v.zoom}
              opacity={flagged.has(label.id) ? 0.9 : 0.35}
              listening={false}
            />
          ))}
          {!mpp && plan.reading && (
            <DraftShapes draft={plan.reading.draft} zoom={v.zoom} listening={tool === 'measure'} />
          )}
        </Layer>
        {mpp && (
          <Layer scaleX={1 / mpp} scaleY={1 / mpp}>
            <Rooms
              plan={shown}
              selection={selection}
              px={px}
              listening={tool === 'select' || tool === 'measure'}
            />
            <Obstacles plan={shown} selection={selection} px={px} listening={tool === 'select'} />
            <Walls
              plan={shown}
              selection={selection}
              px={px}
              listening={tool === 'select' || tool === 'measure'}
            />
            <Openings plan={shown} selection={selection} px={px} listening={tool === 'select'} />
            {tool === 'select' && <Handles plan={shown} selection={selection} px={px} />}
            {draftMeters.length > 0 && (
              <Line
                points={[...draftMeters, ...(nextPoint ? [nextPoint] : [])].flatMap((p) => [
                  p.x,
                  p.y,
                ])}
                stroke="#e11d48"
                strokeWidth={tool === 'wall' ? wallThickness : 2 * px}
                opacity={tool === 'wall' ? 0.5 : 0.9}
                dash={tool === 'split' ? [6 * px, 4 * px] : undefined}
                listening={false}
              />
            )}
            {nextPoint && tool !== 'measure' && (
              <Circle
                x={nextPoint.x}
                y={nextPoint.y}
                radius={(snap?.to === 'none' ? 3 : 5) * px}
                fill={snap?.to === 'none' ? '#e11d48' : '#fff'}
                stroke="#e11d48"
                strokeWidth={1.5 * px}
                listening={false}
              />
            )}
            {nextPoint && draftMeters.at(-1) && (
              <Text
                x={nextPoint.x + 10 * px}
                y={nextPoint.y + 10 * px}
                text={formatLength(distance(draftMeters.at(-1)!, nextPoint), imperial)}
                fontSize={12 * px}
                fill="#e11d48"
                listening={false}
              />
            )}
            {opening && (
              <Line
                points={(() => {
                  const width = Math.min(OPENING_WIDTHS[tool as 'door'], wallLength(opening.wall));
                  const start = Math.min(
                    Math.max(opening.along - width / 2, 0),
                    wallLength(opening.wall) - width,
                  );
                  const a = pointAlong(opening.wall, start);
                  const b = pointAlong(opening.wall, start + width);
                  return [a.x, a.y, b.x, b.y];
                })()}
                stroke="#e11d48"
                strokeWidth={opening.wall.thickness * 1.2}
                opacity={0.6}
                listening={false}
              />
            )}
            {rect && (
              <Rect
                x={Math.min(rect.start.x, rect.end.x)}
                y={Math.min(rect.start.y, rect.end.y)}
                width={Math.abs(rect.end.x - rect.start.x)}
                height={Math.abs(rect.end.y - rect.start.y)}
                fill="#57534e"
                opacity={0.4}
                listening={false}
              />
            )}
          </Layer>
        )}
        <Layer listening={false}>
          <MeasureShapes
            measure={measure}
            draft={tool === 'measure' ? draft : []}
            cursor={
              tool === 'measure'
                ? mpp && cursor?.snap
                  ? { x: cursor.snap.point.x / mpp, y: cursor.snap.point.y / mpp }
                  : cursor?.px
                : undefined
            }
            zoom={v.zoom}
          />
        </Layer>
      </Stage>
      {message && (
        <p
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-stone-900 px-3 py-2
            text-xs text-white"
        >
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * What the reader read, in image pixels, while the plan waits for a scale: faint, and clickable
 * with the Scale tool to measure a wall or a room by.
 */
function DraftShapes(props: { draft: PlanDraft; zoom: number; listening: boolean }) {
  const { draft, zoom, listening } = props;
  const flat = (points: Vec2[]) => points.flatMap((p) => [p.x, p.y]);
  return (
    <Group listening={listening}>
      {draft.rooms.map((r) => (
        <Line
          key={r.id}
          points={flat(r.polygon)}
          closed
          fill="#f59e0b"
          opacity={0.12}
          stroke="#b45309"
          strokeWidth={1 / zoom}
          kind="draft-room"
          elementId={r.id}
        />
      ))}
      {draft.walls.map((w) => (
        <Line
          key={w.id}
          points={flat([w.a, w.b])}
          stroke="#d97706"
          strokeWidth={w.thickness}
          hitStrokeWidth={Math.max(w.thickness, 12 / zoom)}
          lineCap="square"
          opacity={0.45}
          kind="draft-wall"
          elementId={w.id}
        />
      ))}
    </Group>
  );
}

/** The measuring tool's line and outline, in image pixels. */
function MeasureShapes(props: {
  measure: { line?: [Vec2, Vec2]; outline?: Vec2[] };
  draft: Vec2[];
  cursor?: Vec2;
  zoom: number;
}) {
  const { measure, draft, cursor, zoom } = props;
  const flat = (points: Vec2[]) => points.flatMap((p) => [p.x, p.y]);
  return (
    <Group>
      {measure.outline && (
        <Line
          points={flat(measure.outline)}
          closed
          fill="#f59e0b"
          opacity={0.3}
          stroke="#b45309"
          strokeWidth={2 / zoom}
        />
      )}
      {measure.line && <Line points={flat(measure.line)} stroke="#b45309" strokeWidth={3 / zoom} />}
      {draft.length > 0 && (
        <Line
          points={flat([...draft, ...(cursor ? [cursor] : [])])}
          stroke="#b45309"
          strokeWidth={2 / zoom}
          dash={[6 / zoom, 4 / zoom]}
        />
      )}
      {draft.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={4 / zoom}
          fill="#fff"
          stroke="#b45309"
          strokeWidth={1.5 / zoom}
        />
      ))}
    </Group>
  );
}
