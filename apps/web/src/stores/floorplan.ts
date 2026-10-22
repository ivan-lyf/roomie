import type { Floorplan, Materials, Room } from '@roomie/schema';
import { create } from 'zustand';

type FloorplanState = {
  plan: Floorplan | undefined;
  load: (plan: Floorplan) => void;
  /** Changes the home's materials, or with a room, overrides them in that room only. */
  setMaterials: (roomId: string | undefined, change: Partial<Materials>) => void;
  /** Puts a room back on the home's materials. */
  resetRoomMaterials: (roomId: string) => void;
};

export const useFloorplan = create<FloorplanState>()((set) => {
  const edit = (update: (plan: Floorplan) => Floorplan) =>
    set(({ plan }) => (plan ? { plan: update(plan) } : {}));
  const editRoom = (roomId: string, update: (room: Room) => Room) =>
    edit((plan) => ({ ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? update(r) : r)) }));

  return {
    plan: undefined,
    load: (plan) => set({ plan }),
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
  };
});
