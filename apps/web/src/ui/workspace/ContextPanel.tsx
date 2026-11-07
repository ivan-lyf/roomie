import { FURNISHABLE, type Floorplan, type Placement, type Room } from '@roomie/schema';
import { clsx } from 'clsx';
import { ArrowLeftRight, ExternalLink, Plus, RotateCw, Trash2 } from 'lucide-react';
import { familyName } from '../../catalog';
import { roomSides, sizeSummary } from '../../check';
import { ROOM_ICONS } from '../../copy';
import { formatArea, formatDollars, formatLength, formatSides, ROOM_TYPES } from '../../format';
import { furnitureTotals, removeItem, rotateItem, useLayoutProblems } from '../../furnishing';
import { useFloorplan } from '../../stores/floorplan';
import { useFurnish } from '../../stores/furnish';
import { useIntents } from '../../stores/intents';
import { useProducts } from '../../stores/products';
import { useWorkspace } from '../../stores/workspace';
import { Button, Caption, Dimension, Notice, Price, useToast } from '../kit';
import { LookControls } from '../LookControls';
import { TryAnother } from './TryAnother';
import { whyHere } from './whyHere';

type Props = {
  id: string;
  plan: Floorplan;
  roomId: string | undefined;
  imperial: boolean;
  /** Whether the home is saved on the server, so a room can be laid out again. */
  saved: boolean;
};

/** The right-hand panel: the selected piece, else the room in view, else the whole home (§4.6). */
export function ContextPanel(props: Props) {
  const { plan, roomId } = props;
  const selected = useFurnish((s) => s.selected);
  const item = plan.furniture.find((f) => f.id === selected);
  const room = plan.rooms.find((r) => r.id === (item?.roomId ?? roomId));
  return (
    <aside
      aria-label={item ? 'The piece you picked' : room ? room.name : 'Your home'}
      className="flex w-[22rem] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface"
    >
      {item ? (
        <ItemCard plan={plan} item={item} room={room} imperial={props.imperial} />
      ) : room ? (
        <RoomSummary {...props} room={room} />
      ) : (
        <HomeSummary {...props} />
      )}
    </aside>
  );
}


function HomeSummary({ plan, imperial }: Props) {
  const products = useProducts((s) => s.byArticle);
  const { home } = furnitureTotals(plan.furniture, products);
  const budget = useIntents((s) => s.furnishing?.budgetCad ?? undefined);
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <Caption>Your home</Caption>
        <h2 className="m-0 text-2xl font-bold tracking-tight">{plan.name}</h2>
        <p className="m-0 text-ink-muted">
          {plan.rooms.length} rooms · {formatArea(sizeSummary(plan).homeArea, imperial)}
        </p>
      </div>
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-2 border-y border-line py-3">
        <dt className="text-ink-muted">Pieces</dt>
        <dd className="m-0 text-right">{home.count}</dd>
        <dt className="text-ink-muted">Total</dt>
        <dd className="m-0 text-right">
          <Price>{formatDollars(home.priceCad)}</Price>
        </dd>
        {budget !== undefined && (
          <>
            <dt className="text-ink-muted">Your budget</dt>
            <dd className="m-0 text-right">
              <Price>{formatDollars(budget)}</Price>
            </dd>
          </>
        )}
      </dl>
      <p className="m-0 text-ink-muted">Pick a room on the left, or click one in the view, to change it.</p>
      <section className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="m-0 text-lg font-semibold">Walls, floor &amp; light</h3>
        <LookControls plan={plan} roomId={undefined} />
      </section>
    </div>
  );
}

function RoomSummary({ plan, room, imperial, saved }: Props & { room: Room }) {
  const products = useProducts((s) => s.byArticle);
  const select = useFurnish((s) => s.select);
  const busy = useFurnish((s) => s.busy);
  const problems = useLayoutProblems(plan);
  const setSheet = useWorkspace((s) => s.set);
  const Icon = ROOM_ICONS[room.roomType];
  const inRoom = plan.furniture.filter((f) => f.roomId === room.id);
  const subtotal = inRoom.reduce((t, f) => t + (products.get(f.articleNo)?.priceCad ?? 0), 0);
  const { width, depth } = roomSides(plan, room.boundary);
  const furnishable = FURNISHABLE.has(room.roomType) && room.furnishable;
  // Problems with the room's walkways that no one piece is to blame for.
  const ids = new Set(plan.furniture.map((f) => f.id));
  const roomProblems = problems.all.filter(
    (p) => p.roomId === room.id && !p.ids.some((i) => ids.has(i)),
  );

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <Caption>
          {ROOM_TYPES[room.roomType]} · {formatSides(width, depth, imperial)}
        </Caption>
        <h2 className="m-0 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Icon size={22} aria-hidden />
          {room.name}
        </h2>
      </div>

      {!furnishable ? (
        <p className="m-0 text-ink-muted">
          We don&apos;t furnish {ROOM_TYPES[room.roomType].toLowerCase()}s: it&apos;s shown as it is.
        </p>
      ) : inRoom.length === 0 ? (
        <p className="m-0 text-ink-muted">Nothing here yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col border-t border-line p-0">
          {inRoom.map((f) => {
            const p = products.get(f.articleNo);
            const wrong = problems.byItem.get(f.id)?.length ?? 0;
            return (
              <li key={f.id} className="border-b border-line">
                <button
                  type="button"
                  onClick={() => select(f.id)}
                  className="flex w-full items-baseline justify-between gap-3 px-1 py-2.5 text-left hover:bg-canvas"
                >
                  <span className="min-w-0">
                    {wrong > 0 && <span className="sr-only">Needs fixing: </span>}
                    <span className={clsx('font-medium', wrong > 0 && 'text-danger')}>
                      {p ? familyName(p) : 'Loading…'}
                    </span>
                    {p?.color && <span className="block text-sm text-ink-muted">{p.color}</span>}
                  </span>
                  {p && <Price className="shrink-0 text-sm">{formatDollars(p.priceCad)}</Price>}
                </button>
              </li>
            );
          })}
          <li className="flex justify-between px-1 py-2.5 font-semibold">
            Subtotal <Price>{formatDollars(subtotal)}</Price>
          </li>
        </ul>
      )}
      {roomProblems.map((p, i) => (
        <Notice key={i} tone="danger">
          {p.message}
        </Notice>
      ))}

      {furnishable && (
        <div className="flex flex-col gap-3">
          {saved && <TryAnother plan={plan} room={room} />}
          <Button variant="secondary" disabled={busy} onClick={() => setSheet({ sheet: 'add' })}>
            <Plus size={18} aria-hidden /> Add furniture
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="m-0 text-lg font-semibold">Walls, floor &amp; light</h3>
        <LookControls plan={plan} roomId={room.id} />
      </section>
    </div>
  );
}

function ItemCard({
  plan,
  item,
  room,
  imperial,
}: {
  plan: Floorplan;
  item: Placement;
  room: Room | undefined;
  imperial: boolean;
}) {
  const product = useProducts((s) => s.byArticle.get(item.articleNo));
  const busy = useFurnish((s) => s.busy);
  const select = useFurnish((s) => s.select);
  const why = useIntents((s) => whyHere(item, s.furnishing));
  const problems = useLayoutProblems(plan).byItem.get(item.id) ?? [];
  const setSheet = useWorkspace((s) => s.set);
  if (!product) return <p className="p-5 text-ink-muted">Loading…</p>;

  const remove = () => {
    removeItem(item.id);
    useToast.getState().show(`${familyName(product)} removed`, {
      label: 'Undo',
      run: () => useFloorplan.temporal.getState().undo(),
    });
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      <Button variant="quiet" size="sm" className="self-start" onClick={() => select(undefined)}>
        ← {room?.name ?? 'Back'}
      </Button>
      <div className="flex aspect-[4/3] items-center justify-center border border-line bg-surface">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="max-h-full max-w-full object-contain p-3" />
        ) : (
          <span className="font-mono text-xs text-ink-muted">NO PHOTO</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-xl font-bold tracking-tight">{familyName(product)}</h2>
        <p className="m-0 text-ink-muted">
          {product.name.split(' - ').slice(1).join(' - ') || product.color}
        </p>
        <Price className="text-xl">{formatDollars(product.priceCad)}</Price>
        <Dimension className="mt-1 text-ink-muted">
          {formatLength(product.dims.w, imperial)} wide × {formatLength(product.dims.d, imperial)} deep
        </Dimension>
        {product.modelSource === 'procedural' && (
          <p className="m-0 font-mono text-xs text-ink-muted">Shown as a simple shape at its real size</p>
        )}
        {product.status === 'discontinued' && (
          <Notice tone="warn">No longer sold at IKEA. Swap it for one that is.</Notice>
        )}
        <a
          href={product.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 self-start text-ink underline underline-offset-4"
        >
          View on IKEA.ca <ExternalLink size={14} aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>

      <div className="flex flex-wrap gap-2 border-y border-line py-3">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setSheet({ sheet: 'swap' })}>
          <ArrowLeftRight size={16} aria-hidden /> Swap
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => rotateItem(item.id, Math.PI / 2)}>
          <RotateCw size={16} aria-hidden /> Rotate
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={remove}>
          <Trash2 size={16} aria-hidden /> Remove
        </Button>
      </div>

      {problems.map((p, i) => (
        <Notice key={i} tone="danger">
          Doesn&apos;t fit here: {p.message.charAt(0).toLowerCase() + p.message.slice(1)}
        </Notice>
      ))}
      {why && (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 font-mono text-[13px] font-medium tracking-wide text-ink-muted uppercase">
            Why here?
          </h3>
          <p className="m-0 leading-relaxed">{why}</p>
        </section>
      )}
      <p className="m-0 text-sm text-ink-muted">
        Drag it to move it. Arrow keys nudge it, R rotates, Delete removes.
      </p>
    </div>
  );
}
