import { planStatus } from '@roomie/geometry';
import { useEffect } from 'react';
import { Link } from 'wouter';
import demoImage from '../../../../fixtures/plans/00-demo-1br/plan.png';
import { floorplanImageUrl } from '../api';
import { type SaveState, useAutosave } from '../autosave';
import { PlanCanvas } from '../editor/PlanCanvas';
import { DEMO_ID, usePlan } from '../plans';
import { useEditor } from '../stores/editor';
import { redo, undo, useFloorplan } from '../stores/floorplan';
import { Inspector } from '../ui/editor/Inspector';
import { ProblemsPanel } from '../ui/editor/ProblemsPanel';
import { RoomsPanel } from '../ui/editor/RoomsPanel';
import { ScalePanel } from '../ui/editor/ScalePanel';
import { TOOLS, Toolbar } from '../ui/editor/Toolbar';

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  failed: 'Not saved',
  local: 'Demo: changes are not saved',
};

const typing = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement && e.target.closest('input, select, textarea') !== null;

/** The 2D editor: set the scale, then trace or correct the plan over its image. */
export function EditorPage({ id }: { id: string }) {
  const { plan, error } = usePlan(id);
  const save = useAutosave(id);
  const calibrated = Boolean(plan?.scale);

  // A new plan opens on the scale; every visit starts with nothing selected.
  useEffect(() => {
    const editor = useEditor.getState();
    const scale = useFloorplan.getState().plan?.scale;
    editor.select([]);
    editor.setTool(scale ? 'select' : 'measure');
    if (scale && scale.sourceUnit !== 'none')
      editor.set({ imperial: scale.sourceUnit === 'imperial' });
  }, [plan?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const editor = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Escape') {
        if (editor.draft.length > 0) editor.setDraft([]);
        else editor.select([]);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor.selection.length > 0) {
          useFloorplan.getState().remove(editor.selection);
          editor.select([]);
        }
        return;
      }
      if (e.key === 'Enter' && editor.tool === 'room' && editor.draft.length >= 3) {
        editor.select([useFloorplan.getState().addRoom(editor.draft)]);
        editor.setDraft([]);
        return;
      }
      if (key === 'f') {
        window.dispatchEvent(new Event('editor:fit'));
        return;
      }
      const tool = TOOLS.find((t) => t.key === key);
      if (tool && (useFloorplan.getState().plan?.scale || tool.tool === 'measure')) {
        editor.setTool(tool.tool);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error) {
    return (
      <p className="p-8 text-sm text-stone-700">
        {error}{' '}
        <Link href="/" className="underline">
          Back to your plans
        </Link>
      </p>
    );
  }
  if (!plan) return null;
  const status = planStatus(plan);

  return (
    <main className="flex h-full flex-col text-sm text-stone-800">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-3">
        <Link href="/" className="text-stone-500 hover:text-stone-800">
          ← Plans
        </Link>
        <input
          key={plan.name}
          defaultValue={plan.name}
          aria-label="Plan name"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== plan.name) useFloorplan.getState().rename(name);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="w-64 rounded border border-transparent px-2 py-1 font-semibold hover:border-stone-300"
        />
        <span className={`text-xs ${save.state === 'failed' ? 'text-red-700' : 'text-stone-500'}`}>
          {SAVE_LABELS[save.state]}
          {save.state === 'failed' && (
            <button type="button" onClick={save.retry} className="ml-1 underline">
              Retry
            </button>
          )}
        </span>
        <span className="ml-auto text-xs text-stone-500">
          {status === 'ready'
            ? 'Ready for 3D'
            : status === 'needs_calibration'
              ? 'Needs its scale'
              : 'Not finished'}
        </span>
        <Link
          href={`/plans/${id}/3d`}
          className={`rounded-md px-3 py-1.5 ${
            plan.walls.length > 0 && plan.scale
              ? 'bg-stone-800 text-white'
              : 'pointer-events-none bg-stone-200 text-stone-500'
          }`}
        >
          View in 3D
        </Link>
      </header>
      <div className="flex min-h-0 flex-1">
        <Toolbar calibrated={calibrated} />
        <div className="min-w-0 flex-1">
          <PlanCanvas
            key={plan.id}
            plan={plan}
            imageUrl={
              id === DEMO_ID ? demoImage : plan.image ? floorplanImageUrl(plan.id) : undefined
            }
          />
        </div>
        <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-stone-200 bg-white p-4">
          <Section title="Scale">
            <ScalePanel plan={plan} />
          </Section>
          {calibrated && (
            <>
              <Section title="Selected">
                <Inspector plan={plan} />
              </Section>
              <Section title="Rooms">
                <RoomsPanel plan={plan} />
              </Section>
              <Section title="Problems">
                <ProblemsPanel plan={plan} />
              </Section>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{title}</h2>
      {children}
    </section>
  );
}
