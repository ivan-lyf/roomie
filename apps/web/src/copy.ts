import type { PlanProblem } from '@roomie/geometry';
import {
  type Category,
  type FloorplanStatus,
  ROOM_CATEGORIES,
  type RefusalCode,
  type RoomType,
} from '@roomie/schema';
import {
  Bath,
  BedDouble,
  CookingPot,
  DoorOpen,
  type LucideIcon,
  Monitor,
  Shirt,
  Sofa,
  Square,
  Sun,
  Utensils,
  WashingMachine,
} from 'lucide-react';

// The words people see for things the code has its own names for (docs/frontend-design.md §9).
// Internal values map to user sentences here, in one place, never inline in several.

/** One icon per room type (§6). */
export const ROOM_ICONS: Record<RoomType, LucideIcon> = {
  living_room: Sofa,
  bedroom: BedDouble,
  studio: BedDouble,
  dining_area: Utensils,
  den_office: Monitor,
  kitchen: CookingPot,
  bathroom: Bath,
  hallway: DoorOpen,
  closet: Shirt,
  laundry: WashingMachine,
  balcony: Sun,
  other: Square,
};

/** A must-have, as the chip that asks for it; a dining table comes with chairs (§4.4). */
export type MustHave = { label: string; categories: Category[] };

const MUST_HAVES: MustHave[] = [
  { label: 'A bed', categories: ['bed'] },
  { label: 'A sofa', categories: ['sofa'] },
  { label: 'An armchair', categories: ['armchair'] },
  { label: 'A coffee table', categories: ['coffee_table'] },
  { label: 'A dining table with chairs', categories: ['dining_table', 'dining_chair'] },
  { label: 'A desk for working from home', categories: ['desk', 'desk_chair'] },
  { label: 'Shelves or a bookcase', categories: ['shelving'] },
  { label: 'A wardrobe', categories: ['wardrobe'] },
  { label: 'A dresser', categories: ['dresser'] },
  { label: 'Nightstands', categories: ['nightstand'] },
  { label: 'A spot for a TV', categories: ['tv_unit'] },
  { label: 'A rug', categories: ['rug'] },
  { label: 'A floor lamp', categories: ['floor_lamp'] },
];

/** The must-haves that make sense in a room of this type. */
export function mustHavesFor(type: RoomType): MustHave[] {
  const fits = new Set(ROOM_CATEGORIES[type] ?? []);
  return MUST_HAVES.filter((m) => m.categories.every((c) => fits.has(c)));
}

/** A home card's status, in words (§4.1). */
export function homeStatus(status: FloorplanStatus, itemCount: number): string {
  if (itemCount > 0) return 'Furnished';
  if (status === 'needs_calibration') return 'Needs a quick check';
  if (status === 'ready') return 'Ready to furnish';
  return 'Not read yet';
}

/** A problem with the plan as read, as a sentence for "Things to check" (§4.3). */
export function planProblemText(problem: PlanProblem, names: Map<string, string>): string {
  const name = (i: number) => names.get(problem.ids[i] ?? '') ?? 'A room';
  switch (problem.code) {
    case 'no_scale':
      return "We don't know the size of your home yet.";
    case 'no_rooms':
      return "We didn't find any rooms.";
    case 'rooms_overlap':
      return `${name(0)} and ${name(1)} overlap. Is one of them drawn too big?`;
    case 'room_too_small':
      return `${name(0)} looks too small to be a room. Check its outline.`;
    case 'wall_too_short':
      return 'A wall is very short. It may be a stray mark.';
    case 'unknown_wall':
    case 'opening_off_wall':
      return 'A door or window runs past the end of its wall.';
    case 'openings_overlap':
      return 'Two doors or windows overlap on one wall.';
    case 'opening_too_tall':
      return 'A door or window is taller than its wall.';
  }
}

/** Why an AI step didn't start, in words; never tokens or dollars (§4.8). */
export function refusalText(code: RefusalCode | undefined, resetsAt?: Date): string {
  switch (code) {
    case 'sign_in_required':
      return 'Sign in to continue.';
    case 'allowance_reached':
      return (
        "You've used today's share. You can still move, swap and remove furniture. More is " +
        `available ${resetsAt && sameDay(resetsAt) ? 'later today' : 'tomorrow'}.`
      );
    case 'busy':
      return "We're still working on your last request. Try again in a moment.";
    case 'auth_unavailable':
      return "Signing in isn't working right now. Try again in a few minutes.";
    case 'admin_only':
      return "This page isn't open to everyone.";
    default:
      return 'Something went wrong on our side. Try again in a moment.';
  }
}

const sameDay = (d: Date) => d.toDateString() === new Date().toDateString();

/** The words that must never reach a user-facing screen (§2, §11). */
export const BANNED_WORDS = [
  'scale',
  'calibrat',
  'obstacle',
  'residual',
  'candidate',
  'LLM',
  'Gemini',
  'metersPerPixel',
];
