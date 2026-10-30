import {
  GenerationInputs,
  type HomeFurnishing,
  type Layout,
  LoggedIntent,
  Placement,
  type RoomFurnishing,
} from '@roomie/schema';
import { z } from 'zod';

/** A winning layout as the database holds it: its JSONB columns are checked here. */
export type WinnerRow = Pick<Layout, 'id' | 'createdAt'> & {
  inputs: unknown;
  llmIntent: unknown;
  placements: unknown;
};

/**
 * What each room was last furnished from: going back through the home's winning layouts, newest
 * first, the first one that chose its pieces. A rearrange chose none, so the room keeps the
 * intent its pieces came from, reasons and relations included. Rooms since deleted from the plan
 * are left out. The budget and style are the last whole-home furnishing's.
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
    const placements = z.array(Placement).safeParse(row.placements);
    if (!inputs.success || !logged.success || !placements.success) continue;
    const { intent, mode } = logged.data;
    // A rearrange or a revision (M7) chose no pieces.
    if (mode === 'rearrange' || mode === 'revise') continue;
    if (mode === 'home' && furnishing.budgetCad === null) {
      furnishing.budgetCad = inputs.data.budgetCad;
      furnishing.style = inputs.data.style;
    }
    for (const roomId of inputs.data.roomIds) {
      const room = intent.rooms.find((r) => r.roomId === roomId);
      if (!room || found.has(roomId) || !roomIds.has(roomId)) continue;
      found.add(roomId);
      const budgetCad = intent.budget.find((b) => b.roomId === roomId)?.cad;
      const entry: RoomFurnishing = {
        roomId,
        layoutId: row.id,
        intent: room,
        placements: placements.data.filter((p) => p.roomId === roomId),
      };
      if (budgetCad !== undefined) entry.budgetCad = budgetCad;
      furnishing.rooms.push(entry);
    }
  }
  return furnishing;
}
