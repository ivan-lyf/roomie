import { Floorplan } from '@roomie/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import demo from '../../../../fixtures/plans/00-demo-1br/floorplan.json';
import { useFloorplan } from './floorplan';

const plan = Floorplan.parse(demo);
const room = (id: string) => useFloorplan.getState().plan!.rooms.find((r) => r.id === id)!;

describe('floorplan store', () => {
  beforeEach(() => useFloorplan.getState().load(plan));

  it("changes the home's materials", () => {
    useFloorplan.getState().setMaterials(undefined, { wallColor: '#ffffff' });
    expect(useFloorplan.getState().plan!.materials).toEqual({
      ...plan.materials,
      wallColor: '#ffffff',
    });
    expect(room('r1').materials).toBeUndefined();
  });

  it('overrides materials in one room, and resets them', () => {
    const { setMaterials, resetRoomMaterials } = useFloorplan.getState();
    setMaterials('r1', { floor: 'carpet' });
    setMaterials('r1', { wallColor: '#c9d3c0' });
    expect(room('r1').materials).toEqual({ floor: 'carpet', wallColor: '#c9d3c0' });
    expect(useFloorplan.getState().plan!.materials).toEqual(plan.materials);
    resetRoomMaterials('r1');
    expect(room('r1')).not.toHaveProperty('materials');
    expect(room('r4').materials).toEqual({ floor: 'tile' });
  });
});
