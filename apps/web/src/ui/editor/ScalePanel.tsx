import {
  area,
  checkRoomLabels,
  distance,
  scaleFromArea,
  scaleFromAreaAndSide,
  scaleFromWallLength,
} from '@roomie/geometry';
import { type Floorplan, Scale, type ScaleCandidate, type SourceUnit } from '@roomie/schema';
import { useState } from 'react';
import { formatLength, parseLength, parseSquareMeters, squareMeters } from '../../format';
import { type CalibrationMethod, useEditor } from '../../stores/editor';
import { useFloorplan } from '../../stores/floorplan';

const METHODS: Record<CalibrationMethod, string> = {
  wall_length: "A wall's length",
  area: 'An area',
  area_and_side: 'An area and one side',
};

/** What a listed area covers: the outline to trace for it. */
const COVERS = {
  inside: 'Inside the walls',
  with_walls: 'Including the walls',
  with_extras: 'Including a balcony or closets',
} as const;
type Covers = keyof typeof COVERS;

const COVERS_HINT: Record<Covers, string> = {
  inside: 'Trace along the inner face of the walls.',
  with_walls: 'Trace along the outer face of the outside walls.',
  with_extras: 'Trace around everything the figure includes, the balcony or closets too.',
};

const UNITS: Record<SourceUnit, string> = {
  imperial: 'Feet and inches',
  metric_m: 'Meters',
  metric_cm: 'Centimeters',
  metric_mm: 'Millimeters',
  none: 'No unit',
};

const METHOD_NAMES: Record<Scale['method'], string> = {
  labels: "the plan's dimension labels",
  wall_length: "a wall's length",
  area: 'an area',
  area_and_side: 'an area and one side',
};

/**
 * Sets the scale (PLAN.md §5.1): from a measured wall, a known area, or both. Measurements are
 * drawn on the image in pixels, so this works before anything is traced; a new scale rescales
 * everything already drawn.
 */
export function ScalePanel({ plan }: { plan: Floorplan }) {
  const { method, measure, imperial, set, setTool, setDraft } = useEditor();
  const calibrate = useFloorplan((s) => s.calibrate);
  const [lengthText, setLengthText] = useState('');
  const [areaText, setAreaText] = useState('');
  const [covers, setCovers] = useState<Covers>('inside');
  const scale = plan.scale;

  const linePixels = measure.line ? distance(measure.line[0], measure.line[1]) : undefined;
  const outlinePixels = measure.outline ? area(measure.outline) : undefined;
  const meters = parseLength(lengthText, imperial);
  const squareM = parseSquareMeters(areaText, imperial);
  const needsLine = method !== 'area';
  const needsOutline = method !== 'wall_length';

  let result: { scale: Scale; warning?: string } | undefined;
  const sourceUnit = scale?.sourceUnit ?? 'none';
  if (method === 'wall_length' && linePixels && meters) {
    result = {
      scale: {
        metersPerPixel: scaleFromWallLength(linePixels, meters),
        sourceUnit,
        method,
        inputs: { pixels: linePixels, meters, text: lengthText, line: measure.line },
        residual: 0,
      },
    };
  } else if (method === 'area' && outlinePixels && squareM) {
    result = {
      scale: {
        metersPerPixel: scaleFromArea(outlinePixels, squareM),
        sourceUnit,
        method,
        inputs: { pixelArea: outlinePixels, squareMeters: squareM, text: areaText, covers },
        residual: 0,
      },
    };
  } else if (method === 'area_and_side' && linePixels && outlinePixels && meters && squareM) {
    const [a, b] = measure.line!;
    const axis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'x' : 'y';
    const fit = scaleFromAreaAndSide({
      pixelArea: outlinePixels,
      squareMeters: squareM,
      sidePixels: linePixels,
      sideMeters: meters,
      axis,
    });
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    result = {
      scale: {
        metersPerPixel: fit.metersPerPixel,
        sourceUnit,
        method,
        inputs: {
          pixels: linePixels,
          meters,
          pixelArea: outlinePixels,
          squareMeters: squareM,
          covers,
          stretched: fit.stretched,
        },
        residual: fit.disagreement,
      },
      ...(!fit.consistent && {
        warning:
          `The side and the area disagree by ${pct(fit.disagreement)}: one figure is off, the ` +
          `outline doesn't match what the area covers, or the image is stretched (it would take ` +
          `${pct(Math.abs(fit.stretched.y / fit.stretched.x - 1))} more one way than the other). ` +
          'Using the side.',
      }),
    };
  }

  // A plan the reader read but couldn't scale: setting the scale converts what it read.
  const waiting = !scale && plan.reading !== null && plan.walls.length === 0;
  const apply = () => {
    if (!result) return;
    calibrate(result.scale);
    set({ measure: {} });
    setLengthText('');
    setAreaText('');
    if (waiting) setTool('select');
    else if (plan.walls.length === 0) setTool('wall');
  };
  const choose = (candidate: ScaleCandidate) => {
    // As a plain scale: parsing drops `plausible`.
    calibrate(Scale.parse(candidate));
    setTool('select');
  };
  const candidates = waiting ? (plan.reading?.scaleCandidates ?? []) : [];
  const checks = scale ? checkRoomLabels(plan) : [];
  const mpp = scale?.metersPerPixel ?? 0;
  const mpp2 = mpp * mpp;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-stone-600">
        {scale ? (
          <>
            1 px = {(scale.metersPerPixel * 100).toFixed(2)} cm, from {METHOD_NAMES[scale.method]}
            {scale.residual > 0 && <>, {(scale.residual * 100).toFixed(1)}% off the other inputs</>}
            .
          </>
        ) : (
          <>
            Not set yet. Measure something on the plan to set its scale; everything else is drawn in
            meters after.
          </>
        )}
      </p>

      {candidates.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-stone-600">
            The plan&apos;s dimension labels fit more than one unit. Which are they in?
          </p>
          {candidates.map((c) => (
            <button
              key={c.sourceUnit}
              type="button"
              onClick={() => choose(c)}
              className="rounded-md border border-stone-300 px-2 py-1 text-left hover:bg-stone-50"
            >
              {UNITS[c.sourceUnit]}
              <span className="block text-xs text-stone-500">
                Labels agree within {(c.residual * 100).toFixed(1)}%
                {!c.plausible && '; doors or rooms come out odd sizes'}
              </span>
            </button>
          ))}
        </div>
      )}
      {waiting && candidates.length === 0 && (
        <p className="text-xs text-stone-600">
          The plan was read (in orange) but has no dimension labels to scale it by. With the Scale
          tool, click one of its walls or rooms you know the size of.
        </p>
      )}

      <div className="flex flex-col gap-1">
        {(Object.keys(METHODS) as CalibrationMethod[]).map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input
              type="radio"
              checked={method === m}
              onChange={() => {
                set({ method: m, measure: {} });
                setTool('measure');
              }}
            />
            {METHODS[m]}
          </label>
        ))}
      </div>

      {needsOutline && (
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span className="text-stone-500">The figure covers</span>
            <select
              value={covers}
              onChange={(e) => setCovers(e.target.value as Covers)}
              className="rounded border border-stone-300 px-1 py-1"
            >
              {(Object.keys(COVERS) as Covers[]).map((c) => (
                <option key={c} value={c}>
                  {COVERS[c]}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-stone-500">
            {outlinePixels
              ? `Outline drawn${scale ? `: ${squareMeters(outlinePixels * mpp2)} now` : ''}.`
              : `With the Scale tool, click around the area (or click a room). ` +
                COVERS_HINT[covers]}
          </p>
          <input
            value={areaText}
            onChange={(e) => setAreaText(e.target.value)}
            placeholder={imperial ? 'e.g. 560 sq ft' : 'e.g. 52 m²'}
            className="rounded border border-stone-300 px-2 py-1"
          />
        </div>
      )}

      {needsLine && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-stone-500">
            {linePixels
              ? `Line drawn${scale ? `: ${formatLength(linePixels * mpp, imperial)} now` : ''}.`
              : method === 'area_and_side' && !measure.outline
                ? 'Then draw a line along one side of it.'
                : 'With the Scale tool, click both ends of a wall you know the length of ' +
                  '(or click a wall).'}
          </p>
          <input
            value={lengthText}
            onChange={(e) => setLengthText(e.target.value)}
            placeholder={imperial ? `e.g. 12'4"` : 'e.g. 3.6 m'}
            className="rounded border border-stone-300 px-2 py-1"
          />
        </div>
      )}

      {result?.warning && <p className="text-xs text-amber-800">{result.warning}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!result}
          onClick={apply}
          className="rounded-md bg-stone-800 px-3 py-1.5 text-white disabled:opacity-40"
        >
          {scale ? 'Rescale the plan' : 'Set the scale'}
        </button>
        {(measure.line || measure.outline) && (
          <button
            type="button"
            onClick={() => {
              set({ measure: {} });
              setDraft([]);
            }}
            className="rounded-md border border-stone-300 px-3 py-1.5"
          >
            Redraw
          </button>
        )}
      </div>

      {checks.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-stone-600">Dimension labels against the plan</h4>
          <ul className="flex flex-col gap-0.5 text-xs">
            {checks.map((c) => {
              const room = plan.rooms.find((r) => r.id === c.roomId);
              return (
                <li key={c.labelId} className={c.agrees ? 'text-stone-600' : 'text-red-700'}>
                  {c.agrees ? '✓' : '✗'} {room?.name}: label {c.text}, drawn{' '}
                  {c.measured.map((m) => formatLength(m, imperial)).join(' × ')}
                  {` (${(c.error * 100).toFixed(1)}% off)`}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {plan.reading && (
        <p className="text-xs text-stone-400">
          Read by {plan.reading.model} in {Math.round(plan.reading.durationMs / 1000)} s.
        </p>
      )}
    </div>
  );
}
