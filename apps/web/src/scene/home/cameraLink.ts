// Two views of a home that move as one (PLAN.md M7's rating page): turning or zooming one turns
// the other the same way, and a preset view goes to both at once.

/** Where a camera is and what it looks at, in 3D. */
export type Pose = {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
};

/** A view to go to: a corner of the room, by number, or the room from above. */
export type Preset = 1 | 2 | 3 | 4 | 'top';

type View = { apply: (pose: Pose) => void; preset: (preset: Preset) => void };

export class CameraLink {
  private readonly views = new Map<string, View>();
  /** The view the user last took hold of: only its moves are passed on. */
  private driver: string | undefined;

  /** Joins a view to the link; answers how to leave. */
  join(id: string, view: View): () => void {
    this.views.set(id, view);
    return () => {
      this.views.delete(id);
      if (this.driver === id) this.driver = undefined;
    };
  }

  /** The user takes hold of a view's camera. */
  grab(id: string) {
    this.driver = id;
  }

  /**
   * A view's camera moved: the others follow, if it's the one the user is moving. Their own
   * moves, following, aren't passed back.
   */
  moved(id: string, pose: Pose) {
    if (this.driver !== id) return;
    for (const [other, view] of this.views) if (other !== id) view.apply(pose);
  }

  /** Every view goes to the same preset view, and none leads until the user takes hold again. */
  goTo(preset: Preset) {
    this.driver = undefined;
    for (const view of this.views.values()) view.preset(preset);
  }
}
