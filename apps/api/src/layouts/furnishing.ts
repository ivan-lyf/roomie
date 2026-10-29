import {
  GenerationInputs,
  type HomeFurnishing,
  type Layout,
  LoggedIntent,
  type RoomFurnishing,
} from '@roomie/schema';

/** A winning layout, as the database holds it: inputs and intent are JSONB, checked here. */
export type WinnerRow = Pick<Layout, 'id' | 'createdAt'> & { inputs: unknown; llmIntent: unknown };

/**
 * What each room was last furnished from: going back through the home's winning layouts, newest
 * first, the first one that furnished it. Rooms since deleted from the plan are left out. The
 * budget and style are the last whole-home furnishing's.
 */
export function furnishingOf(
  roomIds: ReadonlySet<string>,
  winners: readonly WinnerRow[],
): HomeFurnishing {
  const furnishing: HomeFurnishing = { budgetCad: null, style: null, rooms: [] };
  const found = new Set<string>();
  for (const row of winners.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const inputs = GenerationInputs.safeParse(row.inputs);
    const logged = LoggedIntent.safeParse(row.llmIntent);
    if (!inputs.success || !logged.success) continue;
    const { intent, mode } = logged.data;
    if (mode === 'home' && furnishing.budgetCad === null) {
      furnishing.budgetCad = inputs.data.budgetCad;
      furnishing.style = inputs.data.style;
    }
    for (const roomId of inputs.data.roomIds) {
      const room = intent.rooms.find((r) => r.roomId === roomId);
      if (!room || found.has(roomId) || !roomIds.has(roomId)) continue;
      found.add(roomId);
      const budgetCad = intent.budget.find((b) => b.roomId === roomId)?.cad;
      const entry: RoomFurnishing = { roomId, layoutId: row.id, intent: room };
      if (budgetCad !== undefined) entry.budgetCad = budgetCad;
      furnishing.rooms.push(entry);
    }
  }
  return furnishing;
}
