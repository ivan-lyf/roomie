import type { Floorplan } from '@roomie/schema';
import { useLayoutProblems } from '../../furnishing';
import { useFurnish } from '../../stores/furnish';
import { Furniture, useFloorEvents } from './Furniture';
import { HomeView } from './HomeView';
import { Marks } from './Marks';

type Props = {
  plan: Floorplan;
  /** The room in view; the whole home when undefined. */
  roomId: string | undefined;
  onRoom: (roomId: string | undefined) => void;
  /** Lower the walls between the camera and the rooms in view. */
  cutaway: boolean;
  ceilings: boolean;
};

/**
 * The home being edited, in 3D: its furniture can be picked, placed and moved, with what's wrong
 * marked as it goes (M3, M5).
 */
export function HomeScene({ plan, roomId, onRoom, cutaway, ceilings }: Props) {
  const floorEvents = useFloorEvents(plan, onRoom);
  const problems = useLayoutProblems(plan);
  return (
    <HomeView
      plan={plan}
      roomId={roomId}
      cutaway={cutaway}
      ceilings={ceilings}
      floorEvents={floorEvents}
      onPointerMissed={() => {
        onRoom(undefined);
        useFurnish.getState().select(undefined);
      }}
    >
      <Furniture plan={plan} problems={problems} />
      <Marks plan={plan} problems={problems} />
    </HomeView>
  );
}
