import { FURNISHABLE, type Floorplan } from '@roomie/schema';
import { clsx } from 'clsx';
import { Home } from 'lucide-react';
import { Link } from 'wouter';
import { ROOM_ICONS } from '../../copy';
import { formatDollars } from '../../format';
import { furnitureTotals, problemsByRoom, useLayoutProblems } from '../../furnishing';
import { useProducts } from '../../stores/products';
import { Price } from '../kit';

type Props = {
  id: string;
  plan: Floorplan;
  roomId: string | undefined;
  onRoom: (roomId: string | undefined) => void;
};

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

/** The whole home and every room, with what's in each and what it costs (§4.6). */
export function RoomRail({ id, plan, roomId, onRoom }: Props) {
  const products = useProducts((s) => s.byArticle);
  const { home, byRoom } = furnitureTotals(plan.furniture, products);
  const problems = problemsByRoom(useLayoutProblems(plan).all, plan.furniture);
  const row = (on: boolean) =>
    clsx(
      'flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left',
      on ? 'border-accent bg-surface' : 'border-transparent hover:bg-surface',
    );
  return (
    <nav aria-label="Rooms" className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-canvas">
      <button type="button" className={row(!roomId)} aria-current={!roomId} onClick={() => onRoom(undefined)}>
        <Home size={20} aria-hidden className="mt-0.5 shrink-0" />
        <span className="flex flex-col">
          <span className="font-semibold">Whole home</span>
          <span className="text-sm text-ink-muted">
            {plan.rooms.length} rooms · <Price>{formatDollars(home.priceCad)}</Price>
          </span>
        </span>
      </button>
      <div className="border-t border-line" />
      {plan.rooms.map((room) => {
        const Icon = ROOM_ICONS[room.roomType];
        const totals = byRoom.get(room.id);
        const wrong = problems.get(room.id) ?? 0;
        const furnishable = FURNISHABLE.has(room.roomType);
        return (
          <div key={room.id} className={row(room.id === roomId)}>
            <button
              type="button"
              aria-current={room.id === roomId}
              onClick={() => onRoom(room.id)}
              className="flex min-w-0 flex-1 items-start gap-3 text-left"
            >
              <Icon size={20} aria-hidden className="mt-0.5 shrink-0 text-ink-muted" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{room.name}</span>
                {totals ? (
                  <span className="text-sm text-ink-muted">
                    {items(totals.count)} · <Price>{formatDollars(totals.priceCad)}</Price>
                  </span>
                ) : (
                  <span className="text-sm text-ink-muted">
                    {furnishable && room.furnishable ? 'Not furnished yet' : 'Not furnished'}
                  </span>
                )}
                {wrong > 0 && (
                  <span className="text-sm text-danger">
                    {wrong} {wrong === 1 ? 'thing' : 'things'} to fix
                  </span>
                )}
              </span>
            </button>
            {!totals && furnishable && room.furnishable && (
              <Link href={`/plans/${id}/preferences`} className="text-sm text-accent-ink underline">
                Furnish
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
