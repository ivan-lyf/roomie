import { Floorplan } from '@roomie/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../fixtures/plans/00-demo-1br/floorplan.json';
import { storeChange } from './autosave';
import { undo, useFloorplan } from './stores/floorplan';

const plan = Floorplan.parse(demo);

describe('storeChange', () => {
  it('tells a plan loaded from the server from an edit to save', () => {
    const seen: string[] = [];
    const off = useFloorplan.subscribe((s, prev) => {
      const what = storeChange(s, prev);
      if (what) seen.push(what);
    });
    const store = useFloorplan.getState();
    store.load(plan);
    store.rename('Renamed');
    // Back to the loaded plan, but the server has the rename: that's an edit to save.
    undo();
    store.replace({ ...plan, name: 'Read again' });
    undo();
    store.load({ ...plan, name: 'Loaded again' });
    off();
    expect(seen).toEqual(['loaded', 'edited', 'edited', 'edited', 'edited', 'loaded']);
  });
});
