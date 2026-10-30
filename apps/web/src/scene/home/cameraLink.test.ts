import { describe, expect, it } from 'vitest';
import { CameraLink, type Pose, type Preset } from './cameraLink';

const pose = (x: number): Pose => ({ position: [x, 3, 4], target: [0, 1, 0] });

function views(link: CameraLink) {
  const seen = { a: [] as (Pose | Preset)[], b: [] as (Pose | Preset)[] };
  const leave = (['a', 'b'] as const).map((id) =>
    link.join(id, {
      apply: (p) => seen[id].push(p),
      preset: (p) => seen[id].push(p),
    }),
  );
  return { seen, leave };
}

describe('CameraLink', () => {
  it('passes on the moves of the view the user holds, and only those', () => {
    const link = new CameraLink();
    const { seen } = views(link);
    // Nobody holds a view yet: a move is the camera settling, not the user.
    link.moved('a', pose(1));
    expect(seen).toEqual({ a: [], b: [] });
    link.grab('a');
    link.moved('a', pose(2));
    // b following moves its camera too, which mustn't come back to a.
    link.moved('b', pose(2));
    expect(seen).toEqual({ a: [], b: [pose(2)] });
    link.grab('b');
    link.moved('b', pose(3));
    expect(seen).toEqual({ a: [pose(3)], b: [pose(2)] });
  });

  it('sends a preset view to every view, with no view leading after', () => {
    const link = new CameraLink();
    const { seen } = views(link);
    link.grab('a');
    link.goTo('top');
    link.moved('a', pose(1));
    expect(seen).toEqual({ a: ['top'], b: ['top'] });
  });

  it('forgets a view that leaves', () => {
    const link = new CameraLink();
    const { seen, leave } = views(link);
    leave[1]!();
    link.grab('a');
    link.moved('a', pose(1));
    link.goTo(2);
    expect(seen).toEqual({ a: [2], b: [] });
  });
});
