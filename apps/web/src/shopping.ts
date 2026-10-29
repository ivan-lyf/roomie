import { Category, type Floorplan, type Product } from '@roomie/schema';

// The shopping list (PLAN.md M5): the home's items as they stand, one line per product, with
// what to look at again before buying. Money adds up in cents, so the total is exact.

export type ShoppingLine = {
  articleNo: string;
  /** Unknown when the catalog no longer has it. */
  product: Product | undefined;
  quantity: number;
  /** The rooms it's in, and how many in each, in the plan's order. */
  rooms: { roomId: string; name: string; quantity: number }[];
  unitCad: number | undefined;
  lineCad: number | undefined;
  /** IKEA no longer sells it (as of the last scrape), or the catalog doesn't have it at all. */
  flag?: 'discontinued' | 'missing';
};

export type ShoppingList = {
  lines: ShoppingLine[];
  /** How many items, counting each one. */
  count: number;
  totalCad: number;
  /** What the items IKEA no longer sells come to, within the total. */
  unavailableCad: number;
  /** When the prices were scraped: the latest of them. */
  pricedAt: Date | undefined;
};

const cents = (cad: number) => Math.round(cad * 100);

/** The home's items, one line per product, by the first room each is in, then by category. */
export function shoppingList(
  plan: Pick<Floorplan, 'rooms' | 'furniture'>,
  products: ReadonlyMap<string, Product>,
): ShoppingList {
  const roomOrder = new Map(plan.rooms.map((r, i) => [r.id, i]));
  const byArticle = new Map<string, ShoppingLine>();
  for (const item of plan.furniture) {
    const product = products.get(item.articleNo);
    const line = byArticle.get(item.articleNo) ?? {
      articleNo: item.articleNo,
      product,
      quantity: 0,
      rooms: [],
      unitCad: product?.priceCad,
      lineCad: undefined,
      ...(product
        ? product.status === 'discontinued' && { flag: 'discontinued' as const }
        : { flag: 'missing' as const }),
    };
    line.quantity++;
    const room = line.rooms.find((r) => r.roomId === item.roomId);
    if (room) room.quantity++;
    else {
      const name = plan.rooms.find((r) => r.id === item.roomId)?.name ?? item.roomId;
      line.rooms.push({ roomId: item.roomId, name, quantity: 1 });
    }
    byArticle.set(item.articleNo, line);
  }

  const order = (line: ShoppingLine) =>
    Math.min(...line.rooms.map((r) => roomOrder.get(r.roomId) ?? Infinity));
  const lines = [...byArticle.values()]
    .map((line) => {
      line.rooms.sort((a, b) => (roomOrder.get(a.roomId) ?? 0) - (roomOrder.get(b.roomId) ?? 0));
      const lineCad =
        line.unitCad === undefined ? undefined : (cents(line.unitCad) * line.quantity) / 100;
      return { ...line, lineCad };
    })
    .sort(
      (a, b) =>
        order(a) - order(b) ||
        Category.options.indexOf(a.product?.category ?? 'floor_lamp') -
          Category.options.indexOf(b.product?.category ?? 'floor_lamp') ||
        a.articleNo.localeCompare(b.articleNo),
    );
  const sum = (ls: ShoppingLine[]) => ls.reduce((s, l) => s + cents(l.lineCad ?? 0), 0) / 100;
  const dates = lines.flatMap((l) => (l.product ? [l.product.scrapedAt.getTime()] : []));
  return {
    lines,
    count: lines.reduce((s, l) => s + l.quantity, 0),
    totalCad: sum(lines),
    unavailableCad: sum(lines.filter((l) => l.flag === 'discontinued')),
    pricedAt: dates.length > 0 ? new Date(Math.max(...dates)) : undefined,
  };
}

/** A product's name, with its variant: "MALM Bed frame, high - white Queen". */
export const lineName = (line: ShoppingLine) => line.product?.name ?? 'Not in the catalog';

const STATUS: Record<NonNullable<ShoppingLine['flag']> | 'ok', string> = {
  ok: 'Sold at IKEA',
  discontinued: 'No longer sold',
  missing: 'Not in the catalog',
};

/** A CSV field, quoted when it has to be. */
const field = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const money = (cad: number | undefined) => (cad === undefined ? '' : cad.toFixed(2));

/**
 * The list as CSV, for a spreadsheet: one row per product, then the total. It starts with a
 * byte order mark, so Excel reads it as UTF-8 and shows "Ö" as it is.
 */
export function toCsv(list: ShoppingList): string {
  const rows = [
    [
      'Article number',
      'Product',
      'Quantity',
      'Unit price (CAD)',
      'Line total (CAD)',
      'Rooms',
      'Status',
      'Link',
    ],
    ...list.lines.map((l) => [
      l.articleNo,
      lineName(l),
      String(l.quantity),
      money(l.unitCad),
      money(l.lineCad),
      l.rooms.map((r) => (r.quantity > 1 ? `${r.name} ×${r.quantity}` : r.name)).join('; '),
      STATUS[l.flag ?? 'ok'],
      l.product?.url ?? '',
    ]),
    ['', 'Total', String(list.count), '', money(list.totalCad), '', '', ''],
  ];
  return `\uFEFF${rows.map((r) => r.map(field).join(',')).join('\r\n')}\r\n`;
}

/** The list as plain text, to paste: one line per product, its article number first. */
export function toText(list: ShoppingList): string {
  return list.lines.map((l) => `${l.articleNo} × ${l.quantity}  ${lineName(l)}`).join('\n');
}
