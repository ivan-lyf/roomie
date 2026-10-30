import { z } from 'zod';
import { Placement, StylePreset } from './layout';
import { ArticleNo } from './product';

// What the LLM decides when it furnishes a home (PLAN.md M4): which products go in each room and
// how they relate. Never coordinates: packages/geometry solves for those.

/** What an item is called within its room, to relate it to the others: "sofa", "ns_left". */
export const ItemRef = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
export type ItemRef = z.infer<typeof ItemRef>;

/** Which wall an item stands against. */
export const WallChoice = z.enum(['longest', 'longest_windowless', 'opposite_door', 'any']);
export type WallChoice = z.infer<typeof WallChoice>;

/** Where an item can look besides at another item. */
export const FACING_PLACES = ['window', 'room_center'] as const;

/** How items in a room relate: each kind is one the solver can meet and the scorer measure. */
export const Relation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('against_wall'), item: ItemRef, wall: WallChoice }),
  z.object({
    kind: z.literal('facing'),
    item: ItemRef,
    /** Another item's ref, or "window" or "room_center". */
    target: z.string(),
  }),
  z.object({
    kind: z.literal('in_front_of'),
    item: ItemRef,
    target: ItemRef,
    /** Normal: a coffee table before a sofa. Close: a chair tucked at a desk. */
    distance: z.enum(['normal', 'close']),
  }),
  z.object({
    kind: z.literal('beside'),
    item: ItemRef,
    target: ItemRef,
    /** As seen from the target, looking where it faces. */
    side: z.enum(['left', 'right', 'either']),
  }),
  z.object({ kind: z.literal('around'), items: z.array(ItemRef).min(1), target: ItemRef }),
  z.object({ kind: z.literal('under'), item: ItemRef, targets: z.array(ItemRef).min(1) }),
  z.object({ kind: z.literal('in_corner'), item: ItemRef }),
  z.object({ kind: z.literal('near_window'), item: ItemRef }),
  z.object({ kind: z.literal('away_from_door'), item: ItemRef }),
  /** Two items mirrored about a third: nightstands about a bed. */
  z.object({ kind: z.literal('pair'), first: ItemRef, second: ItemRef, about: ItemRef }),
]);
export type Relation = z.infer<typeof Relation>;

export const IntentItem = z.object({
  ref: ItemRef,
  articleNo: ArticleNo,
  /** Why it's there, in a sentence for the user. */
  why: z.string(),
});
export type IntentItem = z.infer<typeof IntentItem>;

export const RoomIntent = z.object({
  roomId: z.string().min(1),
  items: z.array(IntentItem),
  relations: z.array(Relation),
});
export type RoomIntent = z.infer<typeof RoomIntent>;

/** One home's furnishing plan, from one LLM call. */
export const LayoutIntent = z.object({
  rooms: z.array(RoomIntent),
  /** How the budget was split between the rooms, in CAD. */
  budget: z.array(z.object({ roomId: z.string().min(1), cad: z.number().nonnegative() })),
  /** Anything about the home as a whole: the style it went for, what it left out and why. */
  notes: z.string(),
});
export type LayoutIntent = z.infer<typeof LayoutIntent>;

/**
 * How a generation furnished its rooms: the whole home, one room again (M5), or one room's plan
 * revised from what a rater said ("Tell it", M7).
 */
export const FurnishMode = z.enum(['home', 'rearrange', 'new_pieces', 'revise']);
export type FurnishMode = z.infer<typeof FurnishMode>;

/** What a layout logs of how it was planned (`Layout.llmIntent`). */
export const LoggedIntent = z.object({
  intent: LayoutIntent,
  /** Layouts logged before M5 all furnished whole homes. */
  mode: FurnishMode.default('home'),
  /** The LLM that wrote the intent; none when a room was only rearranged. */
  model: z.string().nullable(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  repairs: z.number().int().nonnegative(),
  /** The solver seeds tried; layouts logged before M5 tried 1 to N. */
  seeds: z.array(z.number().int()).optional(),
  /** A revision's original layout (M7). */
  parent: z.uuid().optional(),
});
export type LoggedIntent = z.infer<typeof LoggedIntent>;

/** The intent a room was last furnished from (M5). */
export const RoomFurnishing = z.object({
  roomId: z.string().min(1),
  /** The winning layout that furnished it. */
  layoutId: z.uuid(),
  intent: RoomIntent,
  /** The room's items as that layout placed them, to score against the room as it is now. */
  placements: z.array(Placement),
  /** What the intent set aside for the room, in CAD. */
  budgetCad: z.number().nonnegative().optional(),
});
export type RoomFurnishing = z.infer<typeof RoomFurnishing>;

/**
 * What a home's furnishings planned: each room's last intent, and the budget and style of the
 * last time the whole home was furnished. All empty for a home furnished by hand.
 */
export const HomeFurnishing = z.object({
  budgetCad: z.number().positive().nullable(),
  style: StylePreset.nullable(),
  rooms: z.array(RoomFurnishing),
});
export type HomeFurnishing = z.infer<typeof HomeFurnishing>;

/** The refs a relation names. */
export function relationRefs(relation: Relation): string[] {
  switch (relation.kind) {
    case 'facing':
      return (FACING_PLACES as readonly string[]).includes(relation.target)
        ? [relation.item]
        : [relation.item, relation.target];
    case 'in_front_of':
    case 'beside':
      return [relation.item, relation.target];
    case 'around':
      return [...relation.items, relation.target];
    case 'under':
      return [relation.item, ...relation.targets];
    case 'pair':
      return [relation.first, relation.second, relation.about];
    default:
      return [relation.item];
  }
}

/**
 * What's wrong with an intent, in words the LLM can act on: rooms it may not furnish, products
 * it wasn't offered, refs used twice or never defined. Empty when it's sound.
 */
export function intentErrors(
  intent: LayoutIntent,
  roomIds: ReadonlySet<string>,
  offered: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const room of intent.rooms) {
    if (!roomIds.has(room.roomId)) errors.push(`Room ${room.roomId} isn't one to furnish.`);
    const refs = new Set<string>();
    for (const item of room.items) {
      if (refs.has(item.ref)) errors.push(`In ${room.roomId}, ref ${item.ref} is used twice.`);
      refs.add(item.ref);
      if (!offered.has(item.articleNo)) {
        const what = `${item.articleNo} (${item.ref} in ${room.roomId})`;
        errors.push(`${what} wasn't in the catalog sent.`);
      }
    }
    for (const relation of room.relations) {
      for (const ref of relationRefs(relation)) {
        if (!refs.has(ref)) {
          errors.push(`In ${room.roomId}, ${relation.kind} names ${ref}, which isn't an item.`);
        }
      }
    }
  }
  return errors;
}
