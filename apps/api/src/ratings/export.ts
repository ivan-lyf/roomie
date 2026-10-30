import { ROOM_FEATURES, scoreFurniture } from '@roomie/geometry';
import {
  Floorplan,
  LoggedIntent,
  Placement,
  Product,
  Rating,
  type RoomIntent,
} from '@roomie/schema';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { floorplans, layouts, products, ratings } from '../db/schema';

// The ratings as training data for ml/ (PLAN.md M7): one row per active rating, with both rooms'
// features worked out again by today's scorer, since the logged breakdowns are of whole homes
// and some come from older scorers; and the notes, as written, with how they were read.

/** One side of a rating: the room in one layout, and how that layout was made. */
type Side = {
  layoutId: string;
  placements: Placement[];
  intent: RoomIntent | undefined;
  logged: LoggedIntent | undefined;
  promptVersion: string;
};

export type Rated = {
  rating: Rating;
  plan: Floorplan;
  a: Side;
  b: Side;
  products: ReadonlyMap<string, Product>;
};

/** The columns before the features, in order. */
const LEAD = [
  'rating_id',
  'created_at',
  'home',
  'floorplan_id',
  'room_id',
  'room_type',
  'source',
  'winner',
  'livable',
  'same_pieces',
  'seconds',
  'tags',
  'label_features',
  'layout_a',
  'layout_b',
  'mode_a',
  'mode_b',
  'model_a',
  'model_b',
  'weights_a',
  'weights_b',
  'prompt_a',
  'prompt_b',
  'score_a',
  'score_b',
] as const;

/** Every column: the lead, then each feature for A and B (empty where it doesn't apply). */
export const COLUMNS: readonly string[] = [
  ...LEAD,
  ...ROOM_FEATURES.flatMap((f) => [`a_${f}`, `b_${f}`]),
];

export type ExportRow = Record<string, string | number | boolean | null>;

const pieces = (placements: readonly Placement[]) =>
  placements
    .map((p) => p.articleNo)
    .toSorted()
    .join(',');

/** A rating as a row: who won, how, and both rooms' features by today's scorer. */
export function exportRow({ rating, plan, a, b, products }: Rated): ExportRow {
  const room = plan.rooms.find((r) => r.id === rating.roomId);
  const score = (side: Side) =>
    scoreFurniture(plan, side.placements, products, {
      intents: side.intent ? [side.intent] : [],
    }).rooms.get(rating.roomId) ?? { score: 0, breakdown: {} };
  const [sa, sb] = [score(a), score(b)];
  const row: ExportRow = {
    rating_id: rating.id,
    created_at: rating.createdAt.toISOString(),
    home: plan.name,
    floorplan_id: plan.id,
    room_id: rating.roomId,
    room_type: room?.roomType ?? null,
    source: rating.source,
    winner: rating.winner,
    livable: rating.livable,
    same_pieces: pieces(a.placements) === pieces(b.placements),
    seconds: rating.seconds,
    tags: rating.tags.join('|'),
    label_features: (rating.labels?.labels ?? []).map((l) => l.feature ?? 'none').join('|'),
    layout_a: a.layoutId,
    layout_b: b.layoutId,
    mode_a: a.logged?.mode ?? null,
    mode_b: b.logged?.mode ?? null,
    model_a: a.logged?.model ?? null,
    model_b: b.logged?.model ?? null,
    weights_a: a.logged?.weights ?? 'current',
    weights_b: b.logged?.weights ?? 'current',
    prompt_a: a.promptVersion,
    prompt_b: b.promptVersion,
    score_a: sa.score,
    score_b: sb.score,
  };
  for (const f of ROOM_FEATURES) {
    row[`a_${f}`] = sa.breakdown[f] ?? null;
    row[`b_${f}`] = sb.breakdown[f] ?? null;
  }
  return row;
}

/** A rating's notes as written, what they're about, and how they were read: one JSON line. */
export function noteLine({ rating, plan, a, b, products }: Rated): string {
  const sides = { a, b };
  const name = (side: 'a' | 'b', id: string) => {
    const placement = sides[side].placements.find((p) => p.id === id);
    return placement ? (products.get(placement.articleNo)?.name ?? null) : null;
  };
  return JSON.stringify({
    ratingId: rating.id,
    home: plan.name,
    roomId: rating.roomId,
    roomType: plan.rooms.find((r) => r.id === rating.roomId)?.roomType ?? null,
    source: rating.source,
    winner: rating.winner,
    livable: rating.livable,
    note: rating.note,
    itemNotes: rating.itemNotes.map((n) => ({ ...n, product: name(n.side, n.placementId) })),
    tags: rating.tags,
    labels: rating.labels,
  });
}

/** A CSV cell: quoted when it has a comma, quote or line break; empty for nothing. */
const cell = (value: ExportRow[string] | undefined) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(rows: readonly ExportRow[]): string {
  const lines = [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))];
  return `${lines.join('\n')}\n`;
}

const Placements = z.array(Placement);

/** Every active rating, with what it compared, from the database. */
export async function loadRated(db: Db): Promise<Rated[]> {
  const rows = (await db.select().from(ratings).where(eq(ratings.status, 'active')))
    .map((r) => Rating.parse(r))
    .toSorted((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.layoutA, r.layoutB]))];
  const logged = await db.select().from(layouts).where(inArray(layouts.id, ids));
  const byId = new Map(logged.map((l) => [l.id, l]));
  const planIds = [...new Set(logged.map((l) => l.floorplanId))];
  const plans = new Map(
    (await db.select().from(floorplans).where(inArray(floorplans.id, planIds))).map((p) => [
      p.id,
      Floorplan.parse(p),
    ]),
  );
  const articleNos = [
    ...new Set(logged.flatMap((l) => Placements.parse(l.placements).map((p) => p.articleNo))),
  ];
  const known = await db.select().from(products).where(inArray(products.articleNo, articleNos));
  const catalog = new Map(
    Product.array()
      .parse(known)
      .map((p) => [p.articleNo, p]),
  );

  return rows.flatMap((rating) => {
    const side = (id: string): Side | undefined => {
      const row = byId.get(id);
      if (!row) return undefined;
      const intent = LoggedIntent.safeParse(row.llmIntent);
      return {
        layoutId: id,
        placements: Placements.parse(row.placements).filter((p) => p.roomId === rating.roomId),
        intent: intent.success
          ? intent.data.intent.rooms.find((r) => r.roomId === rating.roomId)
          : undefined,
        logged: intent.success ? intent.data : undefined,
        promptVersion: row.promptVersion,
      };
    };
    const [a, b] = [side(rating.layoutA), side(rating.layoutB)];
    const plan = plans.get(byId.get(rating.layoutA)?.floorplanId ?? '');
    return a && b && plan ? [{ rating, plan, a, b, products: catalog }] : [];
  });
}
