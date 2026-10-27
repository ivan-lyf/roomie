# Roomie — User-facing frontend design

> How the screens people use should look, read, and behave. Read this before building or changing anything in `apps/web/src/pages` or `apps/web/src/ui`.

The engineering rules in `CLAUDE.md` still apply (units, no LLM coordinates, store-driven undo, `packages/geometry` for validity). This document adds the **who**, the **flow**, the **screens**, and the **words**.

**Assumptions** (change them here if they change):
- Laptop and desktop only, ≥ 1024 px wide. Mobile is out of scope (`PLAN.md` §3).
- The internal pages (`/catalog`, `/admin/rate`) are out of scope: they can stay plain.
- The expert 2D editor (`/plans/:id/edit`) stays as the "fix it myself" path; it is not the default path.

---

## 1. Who it's for

**Primary user:** someone renting or buying an apartment who has a listing's floor plan (image or PDF) and wants to know *what fits and what it costs*. They:

- have never used CAD, a 3D tool, or a room planner;
- don't know design vocabulary ("focal point", "clearance", "scale") and shouldn't need to;
- don't know what furniture sizes work in their rooms; that is why they came;
- care about a budget and want a list they can actually buy from.

**The promise**, shown on the first screen:

> **Upload your floor plan. See your home furnished with IKEA pieces that actually fit, with prices.**

Everything below serves that sentence. If a screen makes the user think about how Roomie works instead of about their home, it is wrong.

---

## 2. Design principles

Each principle comes with the rule that makes it checkable.

1. **Plain words, never internals.** User-facing copy never says scale, calibrate, obstacle, residual, candidate, layout score, LLM, AI model, or Gemini. Use the vocabulary table in §9. *Rule: a test fails on banned words (§11).*
2. **One obvious next step.** Each screen has exactly one primary button, worded as the outcome: "Furnish my home", "Looks right", never "Submit", "Next", or "OK" alone.
3. **Defaults over questions.** Ask only what code cannot infer: budget, style, must-haves, and a size check when the plan has no measurements. Everything else is pre-filled and can be changed later. *Rule: every input has a sensible default; a user who clicks only primary buttons still gets a furnished home.*
4. **Show, then let them adjust.** Every automatic result (rooms read from the plan, a furnished room) is presented as a suggestion, next to an easy way to change it.
5. **Safe to try anything.** Autosave everywhere (`apps/web/src/autosave.ts`), undo and redo everywhere (zundo stores), never hard-delete (`CLAUDE.md`). Ask for confirmation only before something undo cannot reverse.
6. **Explain in design terms.** Any placed item can answer **"Why here?"** in one sentence ("Against the longest wall without windows, facing the TV"), built from the room's intent and the rule that settled the spot. This is how users learn a little design without being taught.
7. **The app keeps the layout valid.** Users can't end up with furniture overlapping, blocking a door, or leaving no room to walk. A drag that breaks a rule shows why, live; on release the item goes back to its last valid spot. Nothing is saved unless `validateLayout()` passes (it lands in `packages/geometry` with M3; until then the workspace has no furniture to move).
8. **The units they think in.** Lengths in feet and inches on imperial plans, meters otherwise, with a units toggle in the top bar. Reuse `formatLength`, `parseLength`, `isImperial` from `apps/web/src/format.ts`. Prices in Canadian dollars ("$1,249"), with the date the price was read.
9. **Calm and quick.** Long waits (reading a plan, furnishing) always show progress, say roughly how long, and keep something useful on screen.

---

## 3. The journey

```
 Upload ──► Reading your plan ──► Check your plan ──► Your preferences ──► Furnishing ──► Your home ──► Shopping list
 (drop a     (progress, ~1–2 min)  (2–3 quick         (rooms, budget,      (progress,     (look, move,   (buy it)
  file)                             questions)          style, must-haves)   < 3 min)       swap, remove)
                     │                   │
                     └── can't read ─────┴── "Fix it myself" ──► advanced editor (/plans/:id/edit) ──► back to Check
```

- The first four steps show a **step bar** at the top: `Plan · Check · Preferences · Your home`. Done steps can be clicked to go back.
- Reopening a plan resumes where it was left (see the statuses in §4.1).
- **Save** (M6) is asked for only when the user clicks Save. Everything else works signed out.

---

## 4. Screens

Every screen spec lists purpose, layout, copy, and states. **Every screen must have** a loading state, an empty state where one applies, and an error state that says *what happened* and *what to do next*.

### 4.1 Landing / My plans — `/`

**Purpose:** start a new home, or reopen one.

```
┌────────────────────────────────────────────────────────────────┐
│  Roomie                                                 [Save] │
│                                                                │
│   Upload your floor plan. See your home furnished with         │
│   IKEA pieces that actually fit, with prices.                  │
│                                                                │
│   ┌──────────────────────────────────────────────────────┐    │
│   │        ⬆  Drop your floor plan here                    │    │
│   │           or [Choose a file]                           │    │
│   │   A photo, screenshot or PDF of the listing's plan     │    │
│   └──────────────────────────────────────────────────────┘    │
│   No plan handy?  [Try a sample apartment →]                   │
│                                                                │
│   Your homes                                                   │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐                       │
│   │ thumb    │ │ thumb    │ │ thumb    │                       │
│   │ Kits 1BR │ │ Studio   │ │ ...      │                       │
│   │ Furnished│ │ Needs a  │ │          │                       │
│   │ $2,340   │ │ quick    │ │          │                       │
│   └──────────┘ └──────────┘ └──────────┘                       │
└────────────────────────────────────────────────────────────────┘
```

- Reuse `preparePlan` and `ACCEPTED` from `apps/web/src/upload.ts`. While it works, show "Getting your plan ready…" then "Uploading…" in the drop zone.
- "Try a sample apartment" opens the demo plan (`DEMO_ID` in `apps/web/src/plans.ts`) at the **Check** step.
- Plan cards show the plan image as a thumbnail, the name, and a status in plain words:

  | Internal state | Card says | Opens at |
  |---|---|---|
  | `uploaded`, not read | "Not read yet" | Reading |
  | `needs_calibration` | "Needs a quick check" | Check |
  | `ready`, no layout | "Ready to furnish" | Preferences |
  | has a layout | "Furnished · $2,340" | Your home |

- Empty: no cards, just the drop zone and the sample link. Error loading the list: "We couldn't load your homes. [Try again]".
- Upload errors are specific: "That file isn't an image or PDF", "That PDF has no pages", "The upload didn't finish; check your connection and [try again]".

### 4.2 Reading your plan

**Purpose:** turn the image into walls and rooms, without the user doing anything.

```
┌──────────────────────────────────────────────────────────┐
│  Plan · Check · Preferences · Your home                  │
│                                                          │
│     ┌──────────────────────────────┐                     │
│     │   the uploaded plan image    │                     │
│     │   with a soft scanning line  │   Reading your plan │
│     │                              │   ✓ Finding walls   │
│     │                              │   ⋯ Reading names   │
│     └──────────────────────────────┘   This usually takes│
│                                        a minute or two.  │
└──────────────────────────────────────────────────────────┘
```

- Replaces today's full-screen overlay "Reading the plan with Gemini…" (`EditorPage.tsx`, `reading.ts`). Step messages are cosmetic if the API doesn't report steps, so don't fake percentages.
- **Can't read it:** "We couldn't read this plan automatically." Actions: [Try a clearer image] [Trace it myself (about 5 minutes)]. When no reader is configured at all, show only the second action.
- On success, go straight to **Check**.

### 4.3 Check your plan (guided) — `/plans/:id/check`

**Purpose:** reach the success criteria (correct size, correct rooms) in under 2 minutes for a studio, without opening the expert editor. A short wizard over `PlanCanvas` in a **view-and-highlight** mode (no tools, no handles). The plan sits on the left at about 60% of the width; the question is on the right.

**Step 1: Size.** The most important check, because a wrong size breaks every fit.

- *Plan had measurements, one unit fits:* show the result in a sentence the user can judge.
  > "Your bedroom comes out about **11′ × 10′** and the whole home about **620 sq ft**. Does that sound right?"
  > [Looks right] · [No, it's off]
- *Several units fit:* a two-choice question with the likely one preselected. "Are the measurements on your plan in **feet and inches** or **meters**?"
- *No measurements on the plan, or the user said "No, it's off":* offer the two simplest methods from `PLAN.md` §5.1, as plain choices:
  - "**I know how long one wall is.**" Highlight a long, clear wall and ask "How long is this wall?" One length input in the user's unit, plus "Pick a different wall".
  - "**I know the total size**" (e.g. from the listing). One area input, plus the question the plan requires: "Does that figure include the balcony and closets?" [Yes] [No] [Not sure].
  - Area plus a side, stretched-image fixes, and the dimension-label table stay in the advanced editor (`ScalePanel.tsx`).
- After any change, re-show the sentence with the new sizes so the user confirms the result, not the math.

**Step 2: Rooms.**

- Each room is drawn filled and labelled on the plan. The panel lists them with a room-type icon, the name, the size, and a type dropdown (labels from `ROOM_TYPES` in `format.ts`).
- Badge furnishable rooms: "We'll furnish this". Below the list: "We furnish living rooms, bedrooms, studios, dining areas and dens. Kitchens and bathrooms are shown, but left as they are."
- Simple actions only: rename, change type, and "These are one room" (select two, merge). Anything harder goes through "Fix it myself".

**Step 3: Doors and windows.**

- Highlight doors and windows on the plan: "We found **5 doors** and **7 windows**. Furniture will keep doors free and leave space to open them."
- Problems from `ProblemsPanel` show as **Things to check**, each a sentence in plain words. Clicking one zooms the plan to it.

**Always present:** "Something's off? [Fix it myself]" opens `/plans/:id/edit`. Its "Done" button returns to Check. Primary button on the last step: **"Looks good, next"**.

**The advanced editor stays**, with a copy pass: tool labels and hints in plain words (Fixture → "Built-in", Passage → "Open doorway", Scale → "Measure"), and the header links back to the Check step instead of to "3D".

### 4.4 Your preferences — `/plans/:id/preferences`

**Purpose:** collect `GenerationInputs` (`packages/schema/src/layout.ts`) on one page, in four short sections. Every field is pre-filled; "Furnish my home" works immediately.

```
┌──────────────────────────────────────────────────────────────────┐
│  Plan · Check · Preferences · Your home                          │
│                                                                  │
│  1  Which rooms should we furnish?                               │
│     [✓ Living room 14′×12′] [✓ Bedroom 11′×10′] [✓ Den 8′×7′]    │
│                                                                  │
│  2  What's your budget for everything?                           │
│     Essentials ───────●────────────── Generous                   │
│                    $2,500                                        │
│     Covers the basics in every room, mostly simpler pieces.      │
│                                                                  │
│  3  Pick a style                                                 │
│     ┌────────┐ ┌────────┐ ┌────────┐                              │
│     │ image  │ │ image  │ │ image  │                              │
│     │ Light &│ │ Clean &│ │ Warm & │                              │
│     │ natural│ │ modern │ │ simple │                              │
│     └────────┘ └────────┘ └────────┘                              │
│                                                                  │
│  4  Anything you need? (optional)                                │
│     Bedroom: [+ Wardrobe] [+ Desk] ...                           │
│     Living room: [+ TV] [+ Armchair] ...                         │
│                                                                  │
│                                      [ Furnish my home → ]       │
└──────────────────────────────────────────────────────────────────┘
```

- **Rooms** (`roomIds`): only furnishable rooms, each a toggle chip with type icon and size; all on by default. At least one must stay on ("Pick at least one room to furnish").
- **Budget** (`budgetCad`): a slider plus an editable dollar field. Three named anchors whose amounts scale with the rooms chosen. Start values per furnished room, to tune once real layouts exist: Essentials ≈ $600, Comfortable ≈ $1,200, Generous ≈ $2,500. One line under the slider says what the amount buys in practice. Default: Comfortable.
- **Style** (`style`): large image cards, one line each. The names map to `StylePreset`; the schema marks the presets as placeholders, so keep the mapping in one place (`ui/preferences/styles.ts`):

  | `StylePreset` | Card title | One line |
  |---|---|---|
  | `scandinavian` | Light & natural | Pale wood, white, soft textiles |
  | `modern` | Clean & modern | Simple shapes, darker tones, little clutter |
  | `warm_minimal` | Warm & simple | Few pieces, warm wood and earthy colours |

  Card images are renders of the demo home furnished in that style (generated once, stored in `public/`). Never use IKEA's photos.
- **Must-haves** (`mustHaves`): optional chips per room, offering only categories that make sense for the room type, in plain words:

  | `Category` | Chip |
  |---|---|
  | `bed` | A bed |
  | `sofa` | A sofa |
  | `armchair` | An armchair |
  | `coffee_table` | A coffee table |
  | `dining_table` + `dining_chair` | A dining table with chairs |
  | `desk` + `desk_chair` | A desk for working from home |
  | `shelving` | Shelves or a bookcase |
  | `wardrobe` | A wardrobe |
  | `dresser` | A dresser |
  | `nightstand` | Nightstands |
  | `tv_unit` | A spot for a TV |
  | `rug` | A rug |
  | `floor_lamp` | A floor lamp |

- If the budget looks too small for the rooms and must-haves chosen, warn without blocking: "That's tight for 3 rooms; we'll keep to the essentials."

### 4.5 Furnishing (progress)

**Purpose:** cover the generation wait (target < 3 min for a home) without a blank spinner.

- Show the **empty 3D home** at full size, with a floating card:
  > Furnishing your home… usually under 3 minutes
  > ✓ Living room · ⋯ Bedroom · ○ Den
- If the API reports rooms as they finish, fill each one in as it completes; otherwise show the whole home at the end.
- **A room couldn't be furnished:** keep the rooms that worked, and for the one that didn't, say why in plain words and offer fixes:
  > "We couldn't fit everything you asked for in the den."
  > [Raise the budget] [Drop the desk] [Leave the den empty]
- **Whole request failed:** "Something went wrong while furnishing. Your plan and choices are saved. [Try again]".
- When done, land in **Your home** with the first tips (§5).

### 4.6 Your home (workspace) — `/plans/:id`

**Purpose:** look at the result, understand it, and tweak it. This is where users spend most of their time. It grows from today's `HomePage` and `HomeScene`.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Homes   Kits 1BR ✎   Saved ✓        ↶ ↷    ft|m     Total $2,340 [Shopping list] [Save] │
├────────────┬───────────────────────────────────────────────┬─────────────────┤
│ Whole home │                                               │  (context panel)│
│ 3 rooms    │                                               │                 │
│ $2,340     │                3D view                        │  Nothing        │
│────────────│                                               │  selected:      │
│ 🛋 Living  │                                               │  room summary   │
│  6 items   │                                               │  + Look         │
│  $1,190    │                                               │                 │
│ 🛏 Bedroom │                                               │  Item selected: │
│  4 items   │                                               │  product card   │
│  $820      │       [Whole home|This room] [3D|Top] [⟲]     │                 │
│ 🍳 Kitchen │       Drag to look around · Scroll to zoom    │                 │
│  not       │                                               │                 │
│  furnished │                                               │                 │
└────────────┴───────────────────────────────────────────────┴─────────────────┘
```

**Top bar:** back to homes, editable name, save state (reuse the labels from `EditorPage`, reworded: "Saved", "Saving…", "Couldn't save · Retry"), undo and redo, units toggle, **running total** linking to the shopping list, and Save (M6).

**Left rail (rooms):** "Whole home" plus every room, with a type icon, item count, and subtotal. Unfurnished rooms say "Not furnished" (kitchens, bathrooms) or "Not furnished yet · [Furnish]" (furnishable rooms the user switched off). Clicking a room frames it, as `HomePanel` does today.

**View controls** (floating at the bottom of the canvas):
- `Whole home | This room`
- `3D | Top view`. The top view (orthographic, from above) is the easiest place for a beginner to move things. Moving works in both views.
- Reset view. The existing "Lower the walls in front" and "Ceilings" toggles move under a small "View options" menu, with walls lowered by default.

**Context panel, nothing selected (room picked):**
- Room name, type, size, item list (each row selectable, so everything works without the 3D canvas), subtotal.
- **"Try another layout for this room"** (M5): regenerates this room only, keeping the others. The old layout stays reachable with undo.
- **"Add furniture"** opens the add sheet (below).
- **Look** section: the existing `LookControls` (paint, floor, light), titled "Walls, floor & light".

**Context panel, item selected:**

```
┌─────────────────────────────┐
│ [product photo]             │
│ KIVIK  3-seat sofa          │
│ Hillared dark blue          │
│ $899                        │
│ 7′ 5″ wide × 3′ 2″ deep     │
│ [View on IKEA.ca ↗]         │
│                             │
│ [⇄ Swap]  [⟳ Rotate]  [🗑 Remove] │
│                             │
│ Why here?                   │
│ Against the longest wall    │
│ without windows, facing     │
│ the TV.                     │
└─────────────────────────────┘
```

- Also shown on hover in 3D: a small label with name and price.
- **Remove** is instant and undoable ("Sofa removed · Undo" toast); no confirmation dialog.
- **Rotate** turns 90° per click. Free rotation is a drag handle in Top view.
- **"Why here?"** is shown only when there is a reason to show. After the user moves an item, it says "You placed this."

**Moving furniture:**
- Drag in either view. Items slide along walls and snap flush to them. The item belongs to the room it's dropped in.
- Validation runs live using `packages/geometry` in the browser. While the spot is invalid, the item turns red and a small label says why, in words:
  - "Blocks the door to the bedroom"
  - "Overlaps the bed"
  - "Leaves less than 75 cm (2′ 6″) to walk past"
  - "Goes through a wall"
- On release over an invalid spot, the item animates back to its last valid position. Every valid move is one undo step.
- Keyboard: arrow keys nudge the selected item (shift for bigger steps), R rotates, Delete removes, Esc deselects.

**Swap drawer** (M5): opens from Swap, as a side sheet.
- "Other sofas that fit here", same category, sorted by how close they are in size and style, with a filter by price.
- Each option shows a photo, name, color, price **difference** ("+$150", "−$80"), and "Fits" or "Too big for this spot" (disabled, still shown so the user learns why).
- Clicking an option previews it in place; "Use this one" confirms. Color variants show as swatches on the card, not as separate items.

**Add furniture sheet** (M3): opens from "Add furniture".
- Categories that suit the room type, as tabs with icons. Filters: price range and "Fits in this room" (on by default).
- Click to add: the item drops at the best valid spot the solver finds; the user can then drag it. Dragging from the sheet into the scene is a nice-to-have.

**Room is at or over budget:** the top-bar total turns amber with "$240 over your budget", never red alarm styling. No blocking.

### 4.7 Shopping list — `/plans/:id/list`

**Purpose:** turn the result into something the user can buy.

```
┌──────────────────────────────────────────────────────────┐
│ ← Back to your home        Shopping list                 │
│                                                          │
│ Living room                                     $1,190   │
│  [img] KIVIK 3-seat sofa · Hillared blue   1   $899  ↗   │
│  [img] LACK coffee table · black-brown     1    $49  ↗   │
│  ...                                                     │
│ Bedroom                                          $820    │
│  ...                                                     │
│──────────────────────────────────────────────────────────│
│ Total  $2,340       Your budget  $2,500 ✓                │
│ Prices from IKEA.ca on Oct 20, 2026. Check before buying.│
│ [Copy list]  [Print]                                     │
│ Roomie isn't affiliated with IKEA.                       │
└──────────────────────────────────────────────────────────┘
```

- Group identical items (four chairs) into one row with a quantity.
- Each row links to the product's IKEA.ca page in a new tab.
- "Copy list" copies plain text (name, color, article number, quantity, price, link). "Print" uses a print stylesheet.
- The price date is the oldest `scrapedAt` among the listed products.

### 4.8 Save and My homes (M6)

- Save opens a small dialog: "**Save this home** to come back to it on any device." [Continue with Google] [Email me a link]. Before then, homes autosave as they do today, without an account, and the top bar says so quietly ("Not saved to an account").
- Signed in, Save is replaced by "Saved ✓", and the landing page's "Your homes" lists account homes. Deleting a home sets a status flag (never a hard delete) and offers Undo in a toast.

---

## 5. First-time help

- No tutorial, manual, or glossary. Labels and the "Why here?" lines carry the teaching.
- At most **three** one-time tips in the workspace, shown one at a time as small popovers next to what they describe:
  1. "Click any piece to see it, swap it, or remove it."
  2. "Drag to move things. We'll stop you if it blocks a door or a path."
  3. "Everything you see is in your shopping list."
- Remember dismissed tips in `localStorage`, wrapped in `try/catch`. Tips must never block the view.
- Every icon-only button has a tooltip and an `aria-label`.

---

## 6. Visual design system

**Feel:** calm, warm, homey. Like a well-lit apartment, not a CAD tool. The 3D home is the hero; the UI frames it and stays quiet.

**Tokens** in `apps/web/src/index.css`, via Tailwind v4 `@theme`, so components use names, not raw colors:

| Token | Use | Start value |
|---|---|---|
| `--color-canvas` | page background | stone-100 `#f5f5f4` (today's) |
| `--color-surface` | panels, cards | white |
| `--color-ink` / `--color-ink-muted` | text | stone-800 / stone-500 |
| `--color-line` | borders | stone-200 |
| `--color-accent` / `--color-accent-ink` | the one primary button, selection, focus | a warm terracotta or deep green, AA on white |
| `--color-ok` / `--color-warn` / `--color-danger` | fits, over budget, invalid spot | green / amber / red, AA |
| `--radius-card` / `--radius-control` | | 12 px / 8 px |
| `--shadow-panel` | floating panels over 3D | soft, one level |

- **Light theme only** for the MVP.
- **Type:** one sans family (Inter from Google Fonts, falling back to the system stack). Body text **16 px** (the current UI uses 14 px `text-sm`, too small for this audience), panel text 14 px minimum, headings 20/24/32 px. Use tabular numbers for prices.
- **Components:** shadcn/ui, as `PLAN.md` §4 already lists (copied into `apps/web/src/ui/kit/`): Button, Dialog, Sheet, Tabs, Slider, Tooltip, Toast, DropdownMenu, Popover. Icons from `lucide-react`. Add nothing heavier.
- **Room-type icons:** one per `RoomType`, from lucide (sofa, bed-double, utensils, monitor, cooking-pot, bath, door-open, shirt, washing-machine, sun, square).
- **Motion:** short (150–250 ms) ease-out for panels and item snap-back; camera moves ≤ 600 ms. Respect `prefers-reduced-motion` (cut instead of animate).
- **Below 1024 px wide:** one friendly screen: "Roomie works best on a laptop or desktop. Open this link there to see your home." Don't try to squeeze the workspace.

---

## 7. Accessibility

- WCAG 2.2 AA contrast for all text and controls.
- Everything reachable by keyboard, with a visible focus ring in the accent color. The 3D canvas is never the only way to do something: the room's item list in the context panel offers select, swap, rotate, remove.
- Color is never the only signal: invalid spots also show a text reason, statuses also have words.
- Use real `<button>`, `<a>`, `<label>` elements. Dialogs and sheets trap focus and close on Esc.
- Dynamic messages (progress, "removed · Undo", save state) go in a polite live region.

---

## 8. Frontend architecture notes

For the implementer; `CLAUDE.md` § Frontend still governs.

**Routes** (wouter, `apps/web/src/App.tsx`):

| Route | Screen | Today |
|---|---|---|
| `/` | Landing and My plans | `PlansPage`, redesigned |
| `/plans/:id/check` | Check your plan | new, wraps `PlanCanvas` |
| `/plans/:id/edit` | Advanced editor | `EditorPage`, copy pass |
| `/plans/:id/preferences` | Your preferences | new |
| `/plans/:id` | Your home (workspace) | grows from `HomePage` |
| `/plans/:id/3d` | redirect to `/plans/:id` | `HomePage` |
| `/plans/:id/list` | Shopping list | new |

Reading and furnishing are states of the Check and Workspace pages, not routes of their own.

**State:**
- `stores/floorplan.ts` (exists): the plan, with undo.
- `stores/layout.ts` (new): placements for the current home, with zundo. Every user edit (move, rotate, add, remove, swap, regenerate a room) is one store action and one undo step. Validation runs in the action through `packages/geometry`; invalid states are never committed.
- `stores/workspace.ts` (new, not undoable): selection, hovered item, open sheet, view mode, units, tips seen. Mirrors `stores/editor.ts`.
- Server data via the existing `api.ts` helpers (or TanStack Query if added, per `PLAN.md` §4).

**Code placement:** 3D in `src/scene/` (reuse `HomeScene`, `ProductModel`; instance repeated models; dispose GLTFs on unmount), panels in `src/ui/` grouped by screen (`ui/check/`, `ui/preferences/`, `ui/workspace/`, `ui/list/`), shared primitives in `ui/kit/`. Copy strings that map internal values to words (room types, categories, styles, validation reasons) live in `src/format.ts` or one `src/copy.ts`, never inline in several places.

**Never** take coordinates from anywhere but the solver or a validated user drag. The frontend doesn't compute furniture positions except through `packages/geometry`.

**API contracts the UI needs** (not built yet; type them from `packages/schema`):

| Need | Shape |
|---|---|
| Start furnishing | `POST /floorplans/:id/layouts` with `GenerationInputs` → a job id |
| Progress | per-room status (`waiting`, `done`, `failed` + a reason code) |
| Result | `Layout` with `placements`, plus a per-placement reason for "Why here?" |
| Regenerate one room | same as start, with one `roomId` and the other rooms' placements kept |
| Swap options | products of a category that fit a given placement, with price |
| Save, list homes | M6 routes |

Reason codes from the API and from `validateLayout()` map to the user sentences in §4.6 in one table in `copy.ts`.

---

## 9. Vocabulary

Use the right-hand column in everything a user sees. The left-hand words are fine in code.

| Internal | User-facing |
|---|---|
| floorplan, plan extraction, reading | your plan, reading your plan |
| scale, calibration, metersPerPixel | size, check the size |
| dimension labels | the measurements on your plan |
| source unit, imperial / metric | feet and inches / meters |
| obstacle, fixture | built-in (counter, closet, radiator…) |
| passage | open doorway |
| opening | door or window |
| room type | what the room is for |
| furnishable | we'll furnish this |
| layout, candidate, best-of-N | your furnished home, a layout, another option |
| placement | where it goes |
| clearance, walkway | space to walk, room to open (doors, drawers) |
| collision, overlap | overlaps the … |
| constraint violation, invalid | doesn't fit here because … |
| style preset | style |
| must-haves | anything you need |
| regenerate | try another layout |
| discontinued | no longer sold at IKEA |
| procedural model / stand-in | (not shown; a small "shape only" note in the product card) |
| LLM, AI, Gemini, Claude | never named; "we" |

**Tone:** friendly, short, direct, second person. Use sentence case and Canadian spelling in copy ("colour", "centre"); code identifiers keep US spelling. Numbers with units ("11′ × 10′", "$1,249"). No exclamation marks in errors, and never blame the user.

---

## 10. Build order

Each phase is its own small PR, matched to `PLAN.md` milestones.

| Phase | Milestone | Scope |
|---|---|---|
| A | now (M2 polish) | tokens and type in `index.css`, `ui/kit` primitives, copy pass with §9 over existing screens, landing redesign, reading state, Check wizard, advanced-editor copy pass |
| B | M3 | workspace shell (top bar, room rail, context panel, view controls, top view), add-furniture sheet, drag and rotate with live validation, item card, shopping list |
| C | M4 | preferences page, furnishing progress and per-room failures, "Why here?" |
| D | M5 | swap drawer, remove with undo toast, try another layout for a room, workspace undo and redo |
| E | M6 | save dialog, sign-in, account homes on the landing page |

---

## 11. Definition of done

A screen or phase is done when:

- [ ] A first-time tester (not a developer) goes from upload to a furnished home and a shopping list **without help**, and can say what each primary button will do before clicking it.
- [ ] It has loading, empty and error states, each with a next step.
- [ ] Every action works by keyboard and passes an axe check with no serious issues.
- [ ] No §9 banned words in user-facing strings: a Vitest (`apps/web/src/copy.test.ts`) scans `src/pages`, `src/ui` and `src/copy.ts` for scale/calibrat/obstacle/residual/candidate/LLM/Gemini/metersPerPixel in JSX text and string literals shown to users.
- [ ] Lengths follow the plan's unit, prices are CAD with a date, and nothing invalid can be saved.
- [ ] `pnpm typecheck && pnpm test && pnpm lint` pass.
