import { type Floorplan, Scale, type ScaleCandidate, type SourceUnit } from '@roomie/schema';
import { type FormEvent, useMemo, useState } from 'react';
import { useHighlight } from './highlight';
import {
  type Includes,
  longWalls,
  pixelPlan,
  scaleFromTotal,
  scaleFromWall,
  sizeSummary,
} from '../../check';
import {
  formatArea,
  formatSides,
  parseLength,
  parseSquareMeters,
  ROOM_TYPES,
} from '../../format';
import { useFloorplan } from '../../stores/floorplan';
import { Button, Chip, Notice, Toggle } from '../kit';
import type { Highlight } from './PlanSheet';

type Props = {
  plan: Floorplan;
  imperial: boolean;
  setImperial: (imperial: boolean) => void;
  /** What the plan should show for this question. */
  onHighlight: (h: Highlight) => void;
  next: () => void;
};

type Way = 'wall' | 'total';

const UNIT_WORDS: Record<SourceUnit, string> = {
  imperial: 'Feet and inches',
  metric_m: 'Meters',
  metric_cm: 'Centimetres',
  metric_mm: 'Millimetres',
  none: 'No unit',
};

/** Step 1, the size: the one check that matters most, since a wrong size breaks every fit. */
export function SizeStep({ plan, imperial, setImperial, onHighlight, next }: Props) {
  const calibrate = useFloorplan((s) => s.calibrate);
  const [off, setOff] = useState(false);
  const candidates = plan.scale ? [] : (plan.reading?.scaleCandidates ?? []);

  if (!plan.scale && candidates.length > 1) {
    return (
      <UnitQuestion
        candidates={candidates}
        onChoose={(c) => {
          calibrate(Scale.parse(c));
          setImperial(c.sourceUnit === 'imperial');
        }}
      />
    );
  }
  if (plan.scale && !off) {
    return (
      <SizeSentence
        plan={plan}
        imperial={imperial}
        onRight={next}
        onOff={() => setOff(true)}
        onHighlight={onHighlight}
      />
    );
  }
  return (
    <SetSize
      plan={plan}
      imperial={imperial}
      setImperial={setImperial}
      onHighlight={onHighlight}
      onDone={() => setOff(false)}
      onCancel={plan.scale ? () => setOff(false) : undefined}
    />
  );
}

function SizeSentence(props: {
  plan: Floorplan;
  imperial: boolean;
  onRight: () => void;
  onOff: () => void;
  onHighlight: Props['onHighlight'];
}) {
  const { plan, imperial } = props;
  const { room, homeArea } = useMemo(() => sizeSummary(plan), [plan]);
  const shown = plan.rooms.find((r) => r.name === room?.name)?.id;
  useHighlight(props.onHighlight, { rooms: true, ...(shown && { room: shown }) });
  return (
    <div className="flex flex-col gap-5">
      <h1 className="m-0 text-2xl font-semibold">Is the size right?</h1>
      <p className="m-0 text-lg leading-normal">
        {room ? (
          <>
            Your {roomWord(room.name)} comes out about{' '}
            <strong>{formatSides(room.width, room.depth, imperial)}</strong> and the whole home about{' '}
            <strong>{formatArea(homeArea, imperial)}</strong>. Does that sound right?
          </>
        ) : (
          <>
            Your home comes out about <strong>{formatArea(homeArea, imperial)}</strong>. Does that
            sound right?
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={props.onRight}>Looks right</Button>
        <Button variant="secondary" onClick={props.onOff}>
          No, it&apos;s off
        </Button>
      </div>
    </div>
  );
}

/** "bedroom" for a room called Bedroom, but a room's own name as it is: "Chambre 2". */
const roomWord = (name: string) =>
  Object.values(ROOM_TYPES).some((t) => t.toLowerCase() === name.toLowerCase())
    ? name.toLowerCase()
    : name;

function UnitQuestion({
  candidates,
  onChoose,
}: {
  candidates: ScaleCandidate[];
  onChoose: (c: ScaleCandidate) => void;
}) {
  const likely = candidates.toSorted(
    (a, b) => Number(b.plausible) - Number(a.plausible) || a.residual - b.residual,
  )[0]!;
  const [picked, setPicked] = useState(likely.sourceUnit);
  const words = candidates.map((c) => UNIT_WORDS[c.sourceUnit].toLowerCase());
  return (
    <div className="flex flex-col gap-5">
      <h1 className="m-0 text-2xl font-semibold">Which units does your plan use?</h1>
      <p className="m-0 text-lg leading-normal">
        Are the measurements on your plan in {words.slice(0, -1).join(', ')} or {words.at(-1)}?
      </p>
      <div role="radiogroup" aria-label="Units on your plan" className="flex flex-wrap gap-2">
        {candidates.map((c) => (
          <Chip key={c.sourceUnit} pressed={picked === c.sourceUnit} onClick={() => setPicked(c.sourceUnit)}>
            {UNIT_WORDS[c.sourceUnit]}
          </Chip>
        ))}
      </div>
      <Button
        className="self-start"
        onClick={() => onChoose(candidates.find((c) => c.sourceUnit === picked) ?? likely)}
      >
        Use {UNIT_WORDS[picked].toLowerCase()}
      </Button>
    </div>
  );
}

function SetSize(props: {
  plan: Floorplan;
  imperial: boolean;
  setImperial: (imperial: boolean) => void;
  onHighlight: Props['onHighlight'];
  onDone: () => void;
  onCancel: (() => void) | undefined;
}) {
  const { plan, imperial } = props;
  const calibrate = useFloorplan((s) => s.calibrate);
  const px = useMemo(() => pixelPlan(plan), [plan]);
  const walls = useMemo(() => longWalls(px.walls), [px]);
  const [way, setWay] = useState<Way>('wall');
  const [wallAt, setWallAt] = useState(0);
  const [text, setText] = useState('');
  const [includes, setIncludes] = useState<Includes>('unsure');
  const [error, setError] = useState<string>();
  const wall = walls[wallAt % Math.max(walls.length, 1)];
  const sourceUnit: SourceUnit = imperial ? 'imperial' : (plan.scale?.sourceUnit ?? 'none');

  useHighlight(
    props.onHighlight,
    way === 'wall' && wall
      ? { wall: { id: wall.id, label: 'How long?' } }
      : { rooms: true },
  );

  if (walls.length === 0) {
    return (
      <Notice tone="warn">
        We couldn&apos;t find the walls on your plan, so we can&apos;t work out its size here. Use
        &ldquo;Fix it myself&rdquo; below to trace them.
      </Notice>
    );
  }

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (way === 'wall') {
      const meters = parseLength(text, imperial);
      if (!meters || !wall) return setError(`Type the wall's length, like ${imperial ? `12' 4"` : '3.6 m'}.`);
      calibrate(scaleFromWall(wall, meters, sourceUnit, text));
    } else {
      const m2 = parseSquareMeters(text, imperial);
      if (!m2) return setError(`Type the total size, like ${imperial ? '620 sq ft' : '58 m²'}.`);
      const scale = scaleFromTotal(px, m2, includes, sourceUnit, text);
      if (!scale) return setError("We couldn't find rooms to measure on your plan.");
      calibrate(scale);
    }
    setText('');
    props.onDone();
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={apply}>
      <h1 className="m-0 text-2xl font-semibold">
        {plan.scale ? "No problem. Which do you know?" : "Let's get the size right"}
      </h1>
      {!plan.scale && (
        <p className="m-0 leading-normal text-ink-muted">
          Your plan has no measurements we could read. One figure you know is enough.
        </p>
      )}
      <div role="radiogroup" aria-label="What you know" className="flex flex-col gap-2">
        <Chip pressed={way === 'wall'} onClick={() => (setWay('wall'), setText(''))}>
          I know how long one wall is.
        </Chip>
        <Chip pressed={way === 'total'} onClick={() => (setWay('total'), setText(''))}>
          I know the total size (from the listing).
        </Chip>
      </div>

      {way === 'wall' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="wall-length" className="font-medium">
            How long is the wall in blue?
          </label>
          <div className="flex items-center gap-3">
            <input
              id="wall-length"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={imperial ? `e.g. 12' 4"` : 'e.g. 3.6 m'}
              className="w-40 rounded-control border border-line-strong bg-surface px-3 py-2.5"
            />
            <UnitToggle imperial={imperial} setImperial={props.setImperial} />
          </div>
          {walls.length > 1 && (
            <Button variant="link" className="self-start text-[15px]" onClick={() => setWallAt(wallAt + 1)}>
              Pick a different wall
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="total-size" className="font-medium">
              What&apos;s the total size?
            </label>
            <div className="flex items-center gap-3">
              <input
                id="total-size"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={imperial ? 'e.g. 620 sq ft' : 'e.g. 58 m²'}
                className="w-40 rounded-control border border-line-strong bg-surface px-3 py-2.5"
              />
              <UnitToggle imperial={imperial} setImperial={props.setImperial} />
            </div>
          </div>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 font-medium">Does that figure include the balcony and closets?</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['yes', 'Yes'],
                  ['no', 'No'],
                  ['unsure', 'Not sure'],
                ] as const
              ).map(([value, label]) => (
                <Chip key={value} pressed={includes === value} onClick={() => setIncludes(value)}>
                  {label}
                </Chip>
              ))}
            </div>
          </fieldset>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit">{way === 'wall' ? 'Use this length' : 'Use this size'}</Button>
        {props.onCancel && (
          <Button variant="link" onClick={props.onCancel}>
            Keep the size as it was
          </Button>
        )}
      </div>
    </form>
  );
}

function UnitToggle({ imperial, setImperial }: { imperial: boolean; setImperial: (i: boolean) => void }) {
  return (
    <Toggle
      label="Units"
      value={imperial ? 'ft' : 'm'}
      onChange={(v) => setImperial(v === 'ft')}
      options={[
        { value: 'ft', label: 'ft' },
        { value: 'm', label: 'm' },
      ]}
    />
  );
}

