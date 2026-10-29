import {
  addWall,
  area,
  centeredOffset,
  convertDraft,
  defaultOpeningHeight,
  deleteWall,
  isTraced,
  labelsIn,
  mergePolygons,
  movePoint,
  moveWall,
  nextId,
  rescalePlan,
  ROOM_NAMES,
  roomTypeFromLabels,
  splitPolygon,
  splitWall,
  uniqueRoomName,
  wallHeight,
  wallLength,
} from '@roomie/geometry';
import {
  FURNISHABLE,
  type Floorplan,
  type Materials,
  type Obstacle,
  type ObstacleKind,
  type Opening,
  type OpeningKind,
  type Placement,
  type Room,
  type RoomType,
  type Scale,
  type SourceUnit,
  type Vec2,
} from '@roomie/schema';
import { temporal } from 'zundo';
import { create } from 'zustand';

/** How wide a new opening is, before the user drags its ends. */
export const OPENING_WIDTHS: Record<OpeningKind, number> = { door: 0.8, window: 1.2, passage: 0.9 };

export type RoomChange = Partial<
  Pick<Room, 'name' | 'roomType' | 'furnishable'> & { ceilingHeight: number | undefined }
>;

type FloorplanState = {
  plan: Floorplan | undefined;
  /** The plan as it was last loaded from the server, so autosave knows it's saved. */
  loaded: Floorplan | undefined;
  /** Starts a plan afresh, with no history to undo. */
  load: (plan: Floorplan) => void;
  /** Swaps in a new version of the plan, such as a fresh reading, as one edit to undo. */
  replace: (plan: Floorplan) => void;
  rename: (name: string) => void;
  /** Changes the home's materials, or with a room, overrides them in that room only. */
  setMaterials: (roomId: string | undefined, change: Partial<Materials>) => void;
  /** Puts a room back on the home's materials. */
  resetRoomMaterials: (roomId: string) => void;

  movePoint: (from: Vec2, to: Vec2) => void;
  moveWall: (wallId: string, delta: Vec2) => void;
  /** Adds a wall and returns its id. */
  addWall: (a: Vec2, b: Vec2, thickness: number) => string;
  splitWall: (wallId: string, at: number) => void;
  setWallThickness: (wallId: string, thickness: number) => void;

  /** Puts an opening of the kind's default size centered `along` meters into a wall. */
  addOpening: (kind: OpeningKind, wallId: string, along: number) => string | undefined;
  setOpening: (
    openingId: string,
    change: Partial<Pick<Opening, 'offset' | 'width' | 'height' | 'sillHeight'>>,
  ) => void;
  flipHinge: (openingId: string) => void;
  flipSide: (openingId: string) => void;

  /** Adds a room, typed and named from the plan's labels inside it. */
  addRoom: (boundary: Vec2[]) => string;
  setRoom: (roomId: string, change: RoomChange) => void;
  /** Cuts a room in two along a line drawn across it; false if the line doesn't cross it. */
  splitRoom: (roomId: string, a: Vec2, b: Vec2) => boolean;
  /** Joins two rooms sharing an edge into the first; false if they don't. */
  mergeRooms: (keepId: string, otherId: string) => boolean;

  addObstacle: (kind: ObstacleKind, polygon: Vec2[]) => string;
  setObstacle: (obstacleId: string, change: Partial<Pick<Obstacle, 'kind' | 'height'>>) => void;

  /** Puts in all new furniture, a furnished layout's, as one edit to undo. */
  setFurniture: (furniture: Placement[]) => void;
  /** Puts a product in a room, and returns the new item's id. */
  placeItem: (item: Omit<Placement, 'id'>) => string;
  /** Moves or turns an item, and sets the room it now stands in. */
  moveItem: (
    itemId: string,
    change: Partial<Pick<Placement, 'x' | 'y' | 'rotation' | 'roomId'>>,
  ) => void;

  /** Removes walls (with their openings), openings, rooms, obstacles and furniture. */
  remove: (ids: readonly string[]) => void;
  /**
   * Sets the scale, rescaling everything drawn under the old one; on a plan the reader read but
   * couldn't scale, converts its draft.
   */
  calibrate: (scale: Scale) => void;
  setCeiling: (height: number) => void;
};

const allIds = (plan: Floorplan) => [
  ...plan.walls.map((w) => w.id),
  ...plan.openings.map((o) => o.id),
  ...plan.rooms.map((r) => r.id),
  ...plan.obstacles.map((o) => o.id),
  ...plan.furniture.map((f) => f.id),
];

/** "Bedroom", then "Bedroom 2" and so on. */
const roomName = (rooms: readonly Room[], type: RoomType) =>
  uniqueRoomName(
    rooms.map((r) => r.name),
    ROOM_NAMES[type],
  );

/**
 * The unit the plan's labels are in, for a scale the user measured: the one the reader's
 * candidates put within 10% of it, so its labels can be checked against it.
 */
function labelUnit(plan: Floorplan, metersPerPixel: number): SourceUnit {
  const near = plan.reading?.scaleCandidates.find(
    (c) => Math.abs(c.metersPerPixel / metersPerPixel - 1) < 0.1,
  );
  return near?.sourceUnit ?? 'none';
}

/** The type and labels of a new outline, from the plan text inside it. */
function fromLabels(plan: Floorplan, boundary: Vec2[], fallback: RoomType = 'other') {
  const labels = labelsIn(plan, boundary);
  return {
    roomType: roomTypeFromLabels(labels) ?? fallback,
    labelTextIds: labels.map((l) => l.id),
  };
}

export const useFloorplan = create<FloorplanState>()(
  temporal(
    (set, get) => {
      const edit = (update: (plan: Floorplan) => Floorplan) =>
        set(({ plan }) => (plan ? { plan: update(plan) } : {}));
      const editRoom = (roomId: string, update: (room: Room) => Room) =>
        edit((plan) => ({
          ...plan,
          rooms: plan.rooms.map((r) => (r.id === roomId ? update(r) : r)),
        }));
      const editOpening = (openingId: string, update: (o: Opening, length: number) => Opening) =>
        edit((plan) => ({
          ...plan,
          openings: plan.openings.map((o) => {
            const wall = plan.walls.find((w) => w.id === o.wallId);
            return o.id === openingId && wall ? update(o, wallLength(wall)) : o;
          }),
        }));
      const id = (prefix: string) => nextId(allIds(get().plan!), prefix);

      return {
        plan: undefined,
        loaded: undefined,
        load: (plan) => {
          set({ plan, loaded: plan });
          useFloorplan.temporal.getState().clear();
        },
        replace: (plan) => edit(() => plan),
        rename: (name) => edit((plan) => ({ ...plan, name })),
        setMaterials: (roomId, change) =>
          roomId
            ? editRoom(roomId, (room) => ({ ...room, materials: { ...room.materials, ...change } }))
            : edit((plan) => ({ ...plan, materials: { ...plan.materials, ...change } })),
        resetRoomMaterials: (roomId) =>
          editRoom(roomId, (room) => {
            const next = { ...room };
            delete next.materials;
            return next;
          }),

        movePoint: (from, to) => edit((plan) => movePoint(plan, from, to)),
        moveWall: (wallId, delta) => edit((plan) => moveWall(plan, wallId, delta)),
        addWall: (a, b, thickness) => {
          const wallId = id('w');
          edit((plan) => addWall(plan, { id: wallId, a, b, thickness }));
          return wallId;
        },
        splitWall: (wallId, at) => {
          const newId = id('w');
          edit((plan) => splitWall(plan, wallId, at, newId));
        },
        setWallThickness: (wallId, thickness) =>
          edit((plan) => ({
            ...plan,
            walls: plan.walls.map((w) => (w.id === wallId ? { ...w, thickness } : w)),
          })),

        addOpening: (kind, wallId, along) => {
          const plan = get().plan;
          const wall = plan?.walls.find((w) => w.id === wallId);
          if (!plan || !wall) return undefined;
          const openingId = id('o');
          const width = Math.min(OPENING_WIDTHS[kind], wallLength(wall));
          const opening: Opening = {
            id: openingId,
            wallId,
            kind,
            offset: centeredOffset(wall, along, width),
            width,
            ...defaultOpeningHeight(kind, wallHeight(plan, wall)),
            ...(kind === 'door' && { swing: { hinge: 'start', side: 'left' } }),
          };
          edit((p) => ({ ...p, openings: [...p.openings, opening] }));
          return openingId;
        },
        setOpening: (openingId, change) =>
          editOpening(openingId, (o, length) => {
            const width = Math.min(change.width ?? o.width, length);
            const offset = Math.min(Math.max(change.offset ?? o.offset, 0), length - width);
            return { ...o, ...change, width, offset };
          }),
        flipHinge: (openingId) =>
          editOpening(openingId, (o) => {
            if (!o.swing) return o;
            const hinge = o.swing.hinge === 'start' ? 'end' : 'start';
            return { ...o, swing: { ...o.swing, hinge } };
          }),
        flipSide: (openingId) =>
          editOpening(openingId, (o) => {
            if (!o.swing) return o;
            const side = o.swing.side === 'left' ? 'right' : 'left';
            return { ...o, swing: { ...o.swing, side } };
          }),

        addRoom: (boundary) => {
          const roomId = id('r');
          edit((plan) => {
            const { roomType, labelTextIds } = fromLabels(plan, boundary);
            const room: Room = {
              id: roomId,
              name: roomName(plan.rooms, roomType),
              roomType,
              boundary,
              labelTextIds,
              furnishable: FURNISHABLE.has(roomType),
            };
            return { ...plan, rooms: [...plan.rooms, room] };
          });
          return roomId;
        },
        setRoom: (roomId, change) =>
          editRoom(roomId, (room) => {
            const next: Room = { ...room, ...change } as Room;
            // A new type brings its own default, unless the same change says otherwise.
            if (change.roomType && change.furnishable === undefined) {
              next.furnishable = FURNISHABLE.has(change.roomType);
            }
            if ('ceilingHeight' in change && change.ceilingHeight === undefined) {
              delete next.ceilingHeight;
            }
            return next;
          }),
        splitRoom: (roomId, a, b) => {
          const plan = get().plan;
          const room = plan?.rooms.find((r) => r.id === roomId);
          const halves = room && splitPolygon(room.boundary, a, b);
          if (!plan || !room || !halves) return false;
          // The original keeps the bigger half; each half takes the labels inside it.
          const [big, small] = halves.toSorted((p, q) => area(q) - area(p)) as [Vec2[], Vec2[]];
          const newId = id('r');
          edit((p) => {
            const kept = fromLabels(p, big, room.roomType);
            const other = fromLabels(p, small, room.roomType);
            const rest = p.rooms.filter((r) => r.id !== roomId);
            const first: Room = { ...room, boundary: big, labelTextIds: kept.labelTextIds };
            const second: Room = {
              ...room,
              id: newId,
              name: roomName([...rest, first], other.roomType),
              roomType: other.roomType,
              boundary: small,
              labelTextIds: other.labelTextIds,
              furnishable: FURNISHABLE.has(other.roomType),
            };
            return {
              ...p,
              rooms: p.rooms.flatMap((r) => (r.id === roomId ? [first, second] : [r])),
            };
          });
          return true;
        },
        mergeRooms: (keepId, otherId) => {
          const plan = get().plan;
          const keep = plan?.rooms.find((r) => r.id === keepId);
          const other = plan?.rooms.find((r) => r.id === otherId);
          const merged = keep && other && mergePolygons(keep.boundary, other.boundary);
          if (!keep || !other || !merged) return false;
          edit((p) => ({
            ...p,
            rooms: p.rooms
              .filter((r) => r.id !== otherId)
              .map((r) =>
                r.id === keepId
                  ? {
                      ...r,
                      boundary: merged,
                      labelTextIds: [...new Set([...r.labelTextIds, ...other.labelTextIds])],
                    }
                  : r,
              ),
          }));
          return true;
        },

        addObstacle: (kind, polygon) => {
          const obstacleId = id('k');
          edit((plan) => ({
            ...plan,
            obstacles: [...plan.obstacles, { id: obstacleId, kind, polygon }],
          }));
          return obstacleId;
        },
        setObstacle: (obstacleId, change) =>
          edit((plan) => ({
            ...plan,
            obstacles: plan.obstacles.map((o) => {
              if (o.id !== obstacleId) return o;
              const next = { ...o, ...change };
              if ('height' in change && change.height === undefined) delete next.height;
              return next;
            }),
          })),

        setFurniture: (furniture) => edit((plan) => ({ ...plan, furniture })),
        placeItem: (item) => {
          const itemId = id('f');
          edit((plan) => ({ ...plan, furniture: [...plan.furniture, { id: itemId, ...item }] }));
          return itemId;
        },
        moveItem: (itemId, change) =>
          edit((plan) => ({
            ...plan,
            furniture: plan.furniture.map((f) => (f.id === itemId ? { ...f, ...change } : f)),
          })),

        remove: (ids) =>
          edit((plan) => {
            const gone = new Set(ids);
            const walls = plan.walls.filter((w) => gone.has(w.id));
            const kept = walls.reduce((p, w) => deleteWall(p, w.id), plan);
            return {
              ...kept,
              openings: kept.openings.filter((o) => !gone.has(o.id)),
              rooms: kept.rooms.filter((r) => !gone.has(r.id)),
              obstacles: kept.obstacles.filter((o) => !gone.has(o.id)),
              furniture: kept.furniture.filter((f) => !gone.has(f.id)),
            };
          }),
        calibrate: (scale) =>
          edit((plan) => {
            const draft = plan.reading?.draft;
            if (!plan.scale && draft && !isTraced(plan)) {
              const sourceUnit =
                scale.sourceUnit === 'none'
                  ? labelUnit(plan, scale.metersPerPixel)
                  : scale.sourceUnit;
              const converted = { ...scale, sourceUnit };
              return {
                ...plan,
                ...convertDraft(draft, converted, plan.ceilingHeight),
                scale: converted,
              };
            }
            const factor = plan.scale ? scale.metersPerPixel / plan.scale.metersPerPixel : 1;
            return { ...rescalePlan(plan, factor), scale };
          }),
        setCeiling: (height) =>
          edit((plan) => ({ ...plan, ceilingHeight: height, ceilingHeightSource: 'user' })),
      };
    },
    {
      partialize: (state) => ({ plan: state.plan }),
      equality: (past, current) => past.plan === current.plan,
      limit: 200,
    },
  ),
);

export const undo = () => useFloorplan.temporal.getState().undo();
export const redo = () => useFloorplan.temporal.getState().redo();
