# Roomie — MVP Plan

> Upload a floor plan, get a furnished 3D home with real IKEA Canada products that actually fits.

## 1. Goal

A user uploads the floor plan of **a single-floor home**, from a studio to a multi-bedroom apartment, and within a few minutes sees every room in 3D, with the livable rooms **furnished and physically valid** using real IKEA.ca products. They can edit the result, and every generated layout is logged and rated so the system gets better over time.

## 2. Success criteria

Measured against a fixed test set of 10–15 real floor plans (e.g. Vancouver rental listings), at least half of them multi-room.

| Area | Criterion |
|---|---|
| Floor plan | Walls, doors, windows, and room boundaries are correct after ≤ 2 min of user correction for a studio, ≤ 5 min for a multi-room plan |
| Room labels | ≥ 90% of rooms get the right type from the plan's text before correction |
| Scale | Units detected correctly on every labelled test plan; computed room dimensions within 3% of the labels or a user-entered measurement |
| Validity | 100% of generated layouts have zero overlaps, zero blocked doors, and walkways ≥ 75 cm. Enforced by code |
| Quality | ≥ 60–70% of generated layouts rated "I'd actually live with this" |
| Speed | Generation < 60 s per furnished room, < 3 min for a whole home; 3D view stays smooth on a laptop |
| Accuracy | Every item has a working IKEA.ca link and correct price; the total adds up |
| Learning | Every layout is logged; the first 100+ pairwise ratings are collected |

## 3. Scope

**In scope**
- Single-floor homes: single rooms, studios, and multi-room apartments
- Every room is extracted and rendered; only furnishable rooms get furniture (see room types below)
- Room labels read from the plan's text ("BR", "Living", "W/D", "Den") and mapped to a room type, which the user confirms
- Scale from the plan's dimension labels, with the units detected automatically, or from user calibration when the plan has no labels (§5.1)
- Furnishable room types: living room, bedroom, studio, dining area, den/office
- Other room types, rendered empty: kitchen, bathroom, hallway, closet, laundry, balcony, other
- Categories: bed, nightstand, sofa, armchair, coffee table, TV unit, dining table + chairs, desk + desk chair, shelving, wardrobe/dresser, rugs, floor lamps
- Every valid IKEA.ca product variant in these categories: about 2,900, not a hand-picked 300–500
- Generation inputs: which rooms to furnish (default: every furnishable room), one budget for the whole home, style preset (2–3) shared across rooms, must-haves per room
- Real 3D rendering for both the room and the products
- Wall color, floor material, and lighting controls
- Click an item to open its link, delete it, or swap it
- Internal pairwise rating page and layout logging
- Sign in before any step that calls an LLM (reading a plan, furnishing), so token use is limited per account (M6)

**Out of scope**
- Multi-storey homes (one floor per plan)
- L-shaped, T-shaped and corner furniture: corner and chaise sofas, L-shaped desks, KALLAX desk combinations, corner wardrobes and bookcases (future goal, §8)
- Sharing rooms with other people
- Live price sync (weekly scrape only)
- Mobile layout
- Furnishing kitchens and bathrooms (they are rendered, with their fixed elements, but get no furniture); wall-mounted items
- Public launch

## 4. Architecture

```
apps/web (React + R3F) ──► apps/api (Node/Hono) ──► Claude API (vision + layout intent)
     │                          │
     └── packages/geometry ◄────┘   (collision, scorer, solver, shared)
                                │
                          Postgres + Supabase Storage
                                ▲
     tools/scraper, tools/models (offline: catalog + 3D models)
     ml/ (Python: ratings → reward model → scorer weights)
```

**Core principle:** the LLM decides *what* goes in each room and *roughly where* (relational intent). Deterministic code decides *exact positions* and guarantees validity. The LLM never outputs final coordinates.

### Stack

| Layer | Choice |
|---|---|
| Frontend | Vite, React, TypeScript, React Three Fiber, drei, @react-three/postprocessing |
| 2D editor | react-konva |
| State / data | Zustand (with undo), TanStack Query |
| UI | Tailwind, shadcn/ui |
| Shared | `packages/schema` (zod), `packages/geometry` (collision, scorer, solver) |
| API | Node, Hono, Anthropic SDK, Drizzle ORM |
| Database | Postgres (Supabase or Neon) |
| Auth | Supabase Auth (M6) |
| Storage | Supabase Storage over its S3 API (GLBs, plan images, screenshots); Cloudflare R2 if downloads outgrow the free plan |
| Scraper | Python (httpx, uv), weekly GitHub Actions cron |
| 3D pipeline | gltf-transform (normalize, decimate, meshopt) |
| ML | Python, pandas, scikit-learn / LightGBM, Jupyter |
| Testing | Vitest (golden floor-plan tests) |
| Deploy | Web on Vercel or Cloudflare Pages; API on Railway or Fly.io |

## 5. Data model (sketch)

All lengths in **meters**. See `CLAUDE.md` for the coordinate conventions.

```ts
Floorplan { id, name, status, image, walls: Wall[], openings: Opening[], rooms: Room[], obstacles: Obstacle[], labels: PlanText[], scale: Scale, ceilingHeight, ceilingHeightSource: 'user' | 'plan' | 'default', materials, reading, editSeconds }
Room      { id, name, roomType, boundary: Vec2[], labelTextIds: string[], furnishable, ceilingHeight?, materials }
Wall      { id, a: Vec2, b: Vec2, thickness }
Opening   { id, wallId, kind: 'door' | 'window' | 'passage', offset, width, height, sillHeight?, swing? }
Obstacle  { id, kind: 'counter' | 'appliance' | 'closet' | 'column' | 'radiator' | 'fireplace' | 'other', polygon: Vec2[], height? }
PlanText  { id, text, bbox, kind: 'room_label' | 'dimension' | 'area' | 'other', parsed?: { meters?, squareMeters?, roomType? } }
Scale     { metersPerPixel, sourceUnit: 'imperial' | 'metric_m' | 'metric_cm' | 'metric_mm', method: 'labels' | 'wall_length' | 'area' | 'area_and_side', inputs, residual }
Product   { articleNo, familyId, options: { name, value }[], name, category, status: 'active' | 'discontinued', priceCad, url, imageUrl, color, material, dims: { w, d, h }, shape: 'rect' | 'round', extendedW, modelUrl, modelSource: 'ikea' | 'procedural', styleTags, scrapedAt }
Layout    { id, floorplanId, inputs, placements: Placement[], score, scoreBreakdown, llmIntent, screenshotUrls, createdAt }
Placement { id, articleNo, roomId, x, y, rotation, ref? }
Rating    { id, layoutA, layoutB, winner, note, createdAt }
```

Walls and openings belong to the floorplan, not to a room, so a wall between two rooms is stored once and takes its height from the ceilings of the rooms it bounds, and a door between them is one opening whose swing can enter either room. A room is a polygon over the floorplan; its walls are the ones along its boundary. Open-plan areas (a living room flowing into a dining area) are separate rooms with no wall between them. `PlanText` keeps every piece of text read from the image, so a wrong room type or scale can be traced back to the label that caused it.

### 5.1 Scale, units, and heights

Scale is a single `metersPerPixel` for the image, fixed once per floorplan before anything else is measured. Units are converted to meters here, at the extraction boundary, and nowhere else.

**Unit detection** (when the user doesn't say), from the dimension and area labels the vision model reads:

| Label looks like | Unit |
|---|---|
| `12'4"`, `12' x 10'`, `12 ft`, `sq ft`, `SF` | imperial (feet and inches) |
| `3.6 m`, `3.6 x 3.0`, `m²`, `sq m` | meters |
| `360 cm` | centimeters |
| bare 4-digit numbers like `3600 x 3000` | millimeters (common on metric architectural drawings) |

Bare numbers are ambiguous, so every hypothesis is checked against the drawing: the implied door widths should be 0.6–1.0 m and the room sizes plausible for their labels. If exactly one unit passes, use it. If none or several pass, ask the user, with the most plausible one preselected. Mixed units on one plan (metric with imperial in brackets) use the primary unit and check against the other.

**Calibration** when the plan has no usable dimension labels, or the user overrides them. The user picks one of:

1. **Wall length.** Select one wall in the 2D editor and enter its measured length (in any unit). `metersPerPixel = length / pixelLength`.
2. **Area.** Enter a known area (usually the listing's total, or one room's) and select what it covers: the whole unit outline or one room. Since the shape is known up to scale, `metersPerPixel = sqrt(area / pixelArea)`. The UI says which outline it measures, because a listing's area often includes walls, closets, or a balcony, and asks whether the figure includes them.
3. **Area plus a measured side.** Both inputs, which over-determine a uniform scale. The side sets the scale and the area becomes a check: if they disagree by more than 5%, show both dimension sets and ask which to trust. A consistent mismatch along one axis means the image is stretched: offer to solve separate x and y scales (the side fixes one axis, the area fixes the product), then resample the plan to a uniform scale before extraction continues.

**Heights.** A floor plan almost never shows heights, so they are defaults the user can change, never something the vision model guesses:

| Height | Default | Notes |
|---|---|---|
| Ceiling | 2.44 m (8 ft) | The most common ceiling height in Canadian apartments. Entered once for the home, optionally overridden per room (lofts, dropped ceilings) |
| Door | 2.03 m (80 in) | Standard interior and entry door |
| Window sill | 0.90 m | Head height defaults to 0.30 m below the ceiling |

A height label on the plan (e.g. `9' CLG`) is used when the text step finds one. Each floorplan records whether its ceiling height was entered, read from the plan, or defaulted, so layouts on defaulted heights can be told apart later.

Every method stores its inputs and a `residual` (how well the other labels or inputs agree with the chosen scale), so a scale can be audited. Dimension labels, when present, are always checked against the calibrated scale and disagreements are flagged in the editor.

## 6. Milestones

Each milestone ends with something demoable. Estimates assume about 10 hours a week, for a total of about **13–16 weeks** (multi-room support adds about 2–3 weeks, mostly in M2 and M4). M1 and M2 are independent and can be interleaved.

### M0 — Foundations (1 week)
- [x] pnpm monorepo: `apps/web`, `apps/api`, `packages/schema`, `packages/geometry`, `tools/`, `ml/`
- [x] zod schemas for every entity above; Drizzle tables generated from them
- [ ] Collect 10–15 test floor plans into `fixtures/plans/` (folder and format ready)
- [x] **Spike:** scrape one category (sofas) end to end: dimensions, price, link, GLB

**Done when:** one sofa renders in a blank R3F scene at its correct real-world size.

### M1 — Catalog (2 weeks)
The catalog keeps **every valid product** in the MVP categories instead of a hand-picked 300–500; generation filters it for each request (M4). The full crawl found 4,146 candidates; after the category rules, **2,937 products** remain. 1,744 of them render with IKEA's own 3D model (330 KB on average), 469 with a sibling variant's (another color or size), and 724 with a stand-in, all at their listed size. L-shaped, T-shaped and corner pieces stay out until the geometry supports them (§8).

- [x] Scraper for every category: IKEA.ca sitemap, each page's JSON-LD and embedded JSON (`tools/scraper`)
- [x] Rate limiting, caching, `scrapedAt` timestamps
- [x] Full crawl: 25,530 products, 0 failures
- [x] Category rules: IKEA category IDs for each MVP category; skip parts, add-ons, and L-shaped pieces
- [x] Dimension normalizer per category: diameter for round tables, rugs, and lamps; bed length as depth; the everyday size of extendable tables, with the extended length stored
- [x] Product fields: footprint shape, extended width, image URL
- [x] Product → variant modeling: colors, sizes, and options grouped into 1,106 families, from each page's pickers
- [x] GLB capture for the catalog: 1,783 models, 0 failures (`pnpm models:download`)
- [x] Model pipeline: rescale to listed dims, origin at bottom center, front facing +Z (checked on 75 samples across every category), fit rules per category, simplify, meshopt compression, textures ≤ 1024 px; 97% of models under 1 MB
- [x] Procedural fallback model per category, at the listed size and tinted with the product's color
- [x] Products without a usable IKEA model of their own show a sibling variant's when it fits within 25% (469 products)
- [x] Products in Postgres; the API reads them from the database (`pnpm catalog:publish`; products gone from IKEA are marked discontinued, never deleted)
- [x] Catalog viewer (category tabs, families with color and size pickers, 3D preview, IKEA model or stand-in badge) and `pnpm catalog:check`
- [x] Models in a private Supabase Storage bucket (2,937 files, about 570 MB), uploaded by `pnpm catalog:publish` and served through signed links; without storage settings the API serves them from disk
- Dropped: taking the height from the model when the listing has none. It would recover about 25 products, whose models aren't downloaded because they aren't in the catalog.
- Deferred until after M4: a weekly GitHub Actions refresh of the MVP categories. It needs model caching between runs and secrets in GitHub, and a public repo must never store IKEA data as workflow artifacts.

**Done when:** every valid product in the MVP categories has valid dimensions, price, and link, renders as its IKEA model or a stand-in, and `pnpm catalog:check` passes.

### M2 — Floorplan (3–4 weeks)
- [x] Schema: `Floorplan` holding walls, openings, rooms, obstacles, plan text, and scale (§5); Drizzle migration and fixtures in the same change
- [x] Floor plan upload (image or PDF)
- [x] Vision-model extraction to Floorplan JSON in plan pixels: walls, openings, room boundaries, fixed obstacles, and every piece of text with its position. Sample furniture drawn on the plan is ignored
- [x] Plan reader chosen by `pnpm plans:eval` on 17 test plans: **Claude Opus 5.5** (about $0.09 and 6–30 s a plan), with Gemini 3 Flash as the free fallback. Room areas within 15%: Opus 90/111, Gemini 65/111, Sonnet 5.5 59/110, Haiku 5.5 55/111; Fable 5.1 was no better than Opus at 3–6× the cost
- [x] Reading cleanup: overlapping room outlines cut apart, inside walls 12 cm and outside walls 15–35 cm thick
- [x] Text → meaning: room labels mapped to room types (abbreviations like `BR`, `LR`, `DR`, `W/D`, `WIC`, `DN`, `ENS`, `PDR`), dimension labels attached to the room or wall they describe, area labels parsed (rooms so far: sizes on dimension lines along walls wait for the test plans)
- [x] Unit detection and scale from the dimension labels (§5.1), with the plausibility checks
- [x] Calibration UI for plans without labels: wall length, area, or area plus side (§5.1); runs before the plan is converted to meters
- [x] Ceiling height: defaults to 2.44 m when the user doesn't enter one or the plan doesn't state it (§5.1); editable for the home and per room
- [x] 2D correction editor: drag wall endpoints, add/move/resize openings, set door swing, split/merge/relabel rooms, add/remove obstacles, recalibrate scale
- [x] 3D render: the whole home with extruded walls, window and door cutouts, floor, ceiling toggle; a room picker that frames one room and cuts away the walls in front of it
- [x] Wall color, floor material (3–5 textures), light warmth and intensity, per room or for the whole home
- [x] Environment lighting, soft shadows, ambient occlusion
- [x] Scale with Opus: within 3% on 15 of 16 test plans, and the 16th (two rooms' labels that disagree) asks for calibration instead of guessing. Area labels are measured inside the walls
- [x] No overlapping rooms in Opus's readings of the test plans: L-shaped rooms no longer trip the overlap check, and thin overlaps on diagonal walls are cut
- [x] Room areas with Opus: within 15% on 91/112 printed rooms, and on 40/45 of the rooms that get furniture. Floor area is measured inside each room's own walls (`floorArea`), for the scale and the eval alike. Most misses are halls and terraces whose printed area covers space the plan doesn't close off with walls; the rest are boundary calls (closets counted in a bedroom, an open plan split elsewhere), left to the editor
- [ ] Timed correction pass in the editor: one studio and one multi-room plan, read by Opus

**Done when:** every test plan becomes a correct 3D home, with rooms labelled and scale within 3%, in ≤ 2 min of correction for a studio and ≤ 5 min for a multi-room plan.

### M3 — Manual furnishing (1–2 weeks)
- [x] Catalog browser (filter by category, price, size)
- [x] Place, drag, and rotate with wall snapping; an item belongs to the room it is dropped in
- [x] Live validation: overlaps (with furniture and obstacles), clearance zones, door swing arcs on both sides of interior doors, items crossing a room boundary, highlighted in red
- [x] Price total per room and for the whole home; product links

**Done when:** you can furnish a test room by hand and the validator catches every bad placement.

#### M3 in detail

**Where the furniture lives.** On the floorplan, as `furniture: Placement[]`: a new JSONB column, saved by the autosave that's already there and undone by the floorplan store's history. `Layout` rows stay what M4 and M7 need, immutable logs of generated candidates. Editing one would spoil the ratings, so M4 *copies* a winner's placements into `furniture`, with the layout's id kept on the floorplan (`furnishedFrom`). M7's implicit signals are then the difference between the two. `Placement` gets an `id`, since two identical chairs can stand in one room. Nothing writes `layouts` yet, so no data migrates. Keeping it in the floorplan store, not a store of its own, means moving a sofa and repainting a wall share one undo history and one save.

**The validator** lives in `packages/geometry/src/layout/` and holds pure functions only. `validateLayout(plan, furniture, products)` returns a list of problems. Each problem has a code, the placement ids involved, and a reason in words. It runs in the browser while you drag, and on the server in M4.

| Code | Fails when |
|---|---|
| `unknown_product` | The placement's article number isn't in the catalog |
| `outside_room` | The footprint isn't inside its room's floor. The floor is the boundary inset by half of each wall along it (`floorPolygon`, the outline `floorArea` measures). Open sides between rooms aren't inset, so a rug can't cross from the living room into the dining area either |
| `wrong_room` | `roomId` isn't the room the item's center stands in, or the room isn't furnishable |
| `overlap` | Two footprints overlap by more than 1 cm, or a footprint overlaps an obstacle. A rug goes under any furniture but another rug. Chairs may go under a table or desk, but not under other furniture |
| `blocks_door` | A footprint enters a door's swing arc, or the clear zone in front of a door or passage on either side of it. That zone is the opening's width, 0.6 m deep. Rugs are exempt |
| `no_clearance` | An item's use zone (table below) holds another item, a wall or an obstacle. The items listed are allowed in it |

Use zones, from common furniture-planning minimums. They live in one table in code, to tune once M7's ratings come in:

| Item | Zone that must stay clear | Allowed in it |
|---|---|---|
| Bed | 0.6 m along one long side, or both for beds 1.4 m wide or more, from the foot to a third of the way back from the head (the nightstands' spot) | Rug |
| Sofa, armchair | 0.35 m in front (legroom, so a coffee table stands at least that far off) | Rug |
| Desk | 0.75 m in front | Chairs, rug |
| Dining table | 0.6 m on every side | Chairs, rug |
| Wardrobe, dresser, shelving, TV unit | 0.6 m in front (doors and drawers) | Rug |
| Nightstand, coffee table, chairs, rug, floor lamp | None | |

Footprints are rectangles from `dims` and `rotation`. Round products (71) are 24-sided polygons. Items and zones are convex, so most checks are a separating-axis test of how deep two shapes overlap; the floor of an L-shaped room and drawn obstacles can be concave, and go through `polygon-clipping`, already a geometry dependency. A room holds about 30 items, so a check on each drag frame is cheap. The walkway rule (75 cm paths from the doors to every zone) stays in M4 with the other whole-home checks.

**The screens** are plain working ones in today's style. The user-facing design comes later, built with Claude Design from `docs/frontend-design.md`.

**Steps,** each one commit and demoable:

1. **Schema:** `Placement.id`; `Floorplan.furniture` (default `[]`) and `furnishedFrom`; a Drizzle migration; the fixtures. The API reads plans saved before this with no furniture. Commit `feat(schema): furniture on the floorplan`.
2. **Validator:** `floorPolygon`, footprints with round shapes, the checks, and `validateLayout`. Tests use made-up products (no IKEA data in the repo), with one test per code. A furnished `00-demo-1br` is checked as valid, then broken one rule at a time. Commit `feat(geometry): validate furniture placements`.
3. **Snapping:** `snapPlacement(placement, product, plan)`, pure and tested. Within 0.15 m of a wall, an item turns square to it (its back or a side to the wall, never its front) and moves flush with the wall's face, or back out if it was dragged into the wall. Within 0.15 m of a second wall, it slides into the corner. Rugs, coffee tables and chairs stand free and don't snap. Rotation steps by 90°, or by 15° with Shift (`turn`). The snap never moves an item into a door's zone if the unsnapped spot is clear of it.
4. **Products by article number:** `GET /products?articleNo=…` (comma-separated), including discontinued ones, so a saved home still finds its items. The web app keeps the products it has seen in a store by article number (`stores/products.ts`), and looks up the ones a home needs in one request.
5. **Furniture in 3D:** `Furniture.tsx` in `scene/home/`, using `ProductModel` (a box while a model loads or for products with no model). Chairs with the same model share one geometry. Store actions: `place`, `move`, `rotate`, `remove`, all undoable.
6. **Catalog browser on the home page:** a "Furnish" tab beside the room picker. It has the category list from `CatalogPanel` and filters for price and maximum width and depth. A "fits this room" toggle hides items larger than the room's floor. The filters are pure functions in `catalog.ts`, with tests.
7. **Place, drag and rotate:** pick a product, then click the floor of a furnishable room; a preview shows where it would go, already checked. Drag moves an item across the floor plane, snapping as it goes (Alt holds the snap off). R rotates it, Delete removes it, arrows nudge it, and Ctrl+Z undoes. The room it ends up in is its `roomId`. The selected item's footprint and use zone are drawn on the floor, and every item with a problem is drawn red, with the doorways it blocks. The room's item list marks items with a problem; the selected item's card, and a label over it in the scene, say what's wrong.
8. **Totals and links:** for each room, its items with name, price and IKEA.ca link, and the room's total; item counts and subtotals on the room list, and the home's total under its name. Prices are the catalog's: the weekly scrape, no live sync. (The shopping list page is M5.)
9. **Done check:** furnish the demo bedroom and living room, plus one Opus-read multi-room test plan, by hand. Try each bad placement from Step 2's list in the UI and check it turns red with the right reason.

   Done on 2026-10-28, in headless Chromium against the dev server: the demo bedroom (bed, two nightstands, wardrobe) and living room (sofa, coffee table, TV bench, armchair, floor lamp), and the bedroom and séjour of fr-56 read by Opus (saved as "Sample fr-56 (Opus)" from the eval's cached reading), all furnished with no problems; fr-56's furniture saved and came back on reload. Each bad placement turned red with the right reason and cleared on undo: an item on another (overlap), in a door's space (blocks_door), dragged through a wall with Alt (outside_room), into the kitchen or bath (wrong_room), and crowding a sofa or wardrobe (no_clearance). Placing exposed one bug, fixed: items stood in the way of clicks on the floor behind them while a product was picked.

Out of M3: swapping items (M5), regenerating rooms (M4/M5), walkways and scores (M4), wall-mounted items, and instancing beyond shared geometry, unless the demo home drops below 60 fps.

### M4 — Auto layout (3–4 weeks)
- [x] **Scorer:** hard constraints (pass/fail) plus soft scores (focal point facing, wall alignment, circulation path from door to each zone, bed access, desk near window, symmetry, budget use)
- [x] **Whole-home checks:** a clear path from the entrance through every interior door to each room; style consistency across rooms; total within budget
- [x] **Solver:** turns relational intent into coordinates (greedy placement plus local random search), one room at a time; rooms meet at doors and at sides open to each other, so each is solved around the furniture already in the rooms before it
- [x] **LLM intent:** a home summary (rooms, types, sizes, how they connect), inputs, and the filtered catalog in; per room, a product list plus relational constraints out (zod-validated). One call plans the whole home, so it splits the budget and keeps the style consistent
- [x] **Repair loop:** solver failures go back to the LLM, which picks smaller substitutes or moves budget between rooms
- [x] **Best-of-N:** generate N candidates, return the top score
- [x] Log every candidate (not just the winner)

**Done when:** 100% of outputs are valid on the test set and ≥ 60% pass your quality bar.

- [x] 100% valid: 16/16 test homes with Haiku 5.5, 4/4 with Opus 5.5 (2026-10-29)
- [x] ≥ 60% rated "I'd live with this": 14 of 16 test homes (88%) on `claude-haiku-5-5`, rated by Ivan on 2026-10-30 from `data/eval/layouts-2026-10-30T05-19-34-claude-haiku-5-5.html`, after the sofa, TV and armchair fixes

#### M4 in detail

**Who does what.** The LLM picks the products and says how they relate ("sofa against the longest wall without windows, facing the TV unit"), as a closed set of relations, never coordinates. `packages/geometry` turns that into positions with a seeded solver, scores every candidate, and ships only layouts that pass `validateLayout`. Everything but the LLM call is pure code, testable without spending anything.

**Walkways**, the hard rule M3 left out, become a check in `validateLayout`:

| Code | Fails when |
|---|---|
| `blocks_path` | In a furnished room, a door can't be reached from another of the room's doors, or an item's use zone can't be reached from a door, along a path at least 75 cm wide. Rugs don't block. The floor is a 5 cm grid, eroded by 37.5 cm, then searched breadth-first from each door's clear zone |

Unfurnished rooms are empty, so a home whose furnished rooms all pass has a clear path from the entrance to every room: the whole-home path check reduces to this one.

**The intent** (`packages/schema`, `LayoutIntent`), one LLM answer per home:

- Per room: items, each with a `ref` ("sofa", "ns_left"), an `articleNo` from the candidates sent, and a one-line reason (kept for M5's "Why here?").
- Per room: relations between them, from a closed list the solver knows how to meet and the scorer how to measure:

  | Relation | Meaning |
  |---|---|
  | `against_wall` | back to a wall: the longest, the longest without windows, the one opposite the door, or any |
  | `facing` | turned to an item, a window, or the room's middle |
  | `in_front_of` | in front of an item, at a normal or a close distance (a coffee table before a sofa) |
  | `beside` | beside an item, on its left, right or either side (nightstands by the bed's head) |
  | `around` | chairs around a table |
  | `under` | a rug under some items |
  | `in_corner`, `near_window`, `away_from_door` | where it stands in the room |
  | `pair` | two items mirrored about a third (nightstands about a bed) |

- How the budget was split between rooms.

**Candidates for the prompt** (`apps/api`): the catalog is too big to send (2,937 products, 1,106 families). Per room, the categories that suit its type, then per category up to 12 families that fit the room (M3's filter), sit in the room's share of the budget, and match the style. The catalog has no style tags, only IKEA's colour and material words, so each style preset is a table of the colours and materials it likes (light wood, white and beige for `scandinavian`; black, grey and metal for `modern`; oak, brown and natural fibres for `warm_minimal`), in one place to tune. About 150 lines of candidates per home.

**The scorer** (`packages/geometry/src/layout/score.ts`): soft scores in [0, 1], each logged in `scoreBreakdown`, weighted by `packages/geometry/weights.json` (new: hand-set weights to start, replaced by M7's fitted ones). Per room: relations met (with partial credit by distance and angle), items against walls flush, seating facing its focal point, walkway width beyond the 75 cm minimum, beds with their heads to a wall, desks near a window, symmetry of pairs, tall items kept clear of windows, and furniture spread over the room. Per home: style agreement across rooms (colours and materials) and budget use (70–100% of it scores best; over budget is a hard fail).

**The solver** (`packages/geometry/src/layout/solve.ts`), one room at a time, each around the furniture already chosen for rooms open to it, with an injected seed:

1. Anchors first (bed, sofa, desk, dining table, wardrobe, TV unit), then the items that hang off them (nightstands, coffee table, chairs, rug, lamps).
2. For each item, candidate spots: along each wall face every 10 cm (via M3's snapping), in corners, relative to an item already placed (in front of, beside, around), or on the open floor for free-standing items. Spots that break a hard rule are dropped; the best-scoring one is kept.
3. Local random search: nudge, slide along a wall, swap walls, mirror, for a fixed number of steps, keeping only moves that stay valid and score higher.
4. An item with no valid spot fails the room, with a reason ("the 1.8 m bed doesn't fit Bedroom 2 with 60 cm on both sides").

**The pipeline** (`POST /floorplans/:id/layouts` with `GenerationInputs`, then `GET` for progress per room):

1. One intent call for the home: prompt `layout-intent.v1`, structured output checked with zod, the model and effort from config (`LAYOUT_MODEL`, `LAYOUT_EFFORT`). On a malformed answer or an article number that wasn't sent, ask once more with the error, then fail cleanly.
2. Best-of-N: N = 8 solver seeds per room. A room's candidates are its N layouts; the home's winner combines each room's best, then passes the whole-home checks.
3. Repair loop, at most twice: rooms that failed go back to the LLM in the same conversation, with the solver's reasons, for smaller substitutes or a new budget split. A room that still fails ships without the items that don't fit, and says so; nothing invalid ships.
4. Every candidate is logged as a `Layout` row (status `candidate`, the winner `winner`): inputs, intent, placements, score and breakdown, prompt version. The winner's placements are copied into `Floorplan.furniture`, with `furnishedFrom` set, as M3 planned.

Intents are cached by home, inputs, model and prompt version, like readings, so reruns cost nothing. An intent call is about 10k tokens in and 3–5k out: roughly $0.10–0.15 a home on Opus 5.5, $0.06 on Sonnet 5.5, under $0.01 on Haiku 5.5. The Claude key has about $2.25 left, so the solver and scorer are built on hand-written intents, and the model is picked by a small bake-off.

**Steps,** each one commit and demoable:

1. **Walkways:** `blocks_path` in `validateLayout`, with tests on the demo home (a sofa that walls off the bedroom door's path fails), and drawn red in the M3 marks.
2. **Intent schema:** `LayoutIntent` and its relations in `packages/schema`, with hand-written intents for the two fixture homes (made-up products, like M3's tests).
3. **Scorer:** each feature with a test, `weights.json`, and `scoreLayout` returning a score and its breakdown.
4. **Solver:** `solveRoom(plan, intent, products, { seed, others })`. Tests: the fixture intents solve to valid layouts that meet their relations, the same seed gives the same layout, and an impossible room fails with a reason.
5. **Candidates:** the catalog filter per room, the style tables, and the budget split, with tests.
6. **Intent call:** the prompt, the Claude call (structured output, one retry, refusal and limit errors as in the plan reader), the intent cache, and config. Tests with a fake client.
7. **Pipeline:** the route, best-of-N, whole-home checks, the repair loop, logging every candidate, and copying the winner into the plan. Tests with a fake LLM.
8. **Furnish for me:** in the Furnish tab, the inputs (rooms, budget, style, must-haves, all with defaults), progress per room, and the result as one edit to undo. Plain UI, as in M3.
9. **`pnpm layouts:eval`:** furnishes each test home (the fixtures plus the Opus readings of the eval plans) with fixed inputs from cached intents. It reports validity (must be 100%), scores, seconds per room and per home (goals: under 60 s and 3 min), and cost, and renders a top-down picture of each home on one contact sheet.
10. **Done check:** 100% valid on the test set, and at least 60% of the contact sheet's homes rated "I'd live with this" by you.

    Run on 2026-10-29. Every winner passed `validateLayout`: 16/16 homes with `claude-haiku-5-5` (mean score 0.88, slowest home 37 s, $0.06 for all 16) and 4/4 with `claude-opus-5-5` on the demo one-bedroom, the studio, fr-12 and fr-27 (mean 0.90, slowest 66 s, $0.55, $0.08–0.27 a home). One real furnishing through the web app, of fr-56 as Opus read it, took $0.08 and gave 11 valid items for $2,054 of a $2,400 budget. Two things the runs changed: rooms open to each other share walkways, so rooms are solved one after another, each around the furniture already chosen next door, not in parallel; and polygon clipping, which throws on a rare near-degenerate shape, falls back to a sampled area. Seen on the sheets: layouts are sensible on the whole (beds against walls with nightstands either side, a sofa, coffee table and rug together), with misses still to tune: a nightstand left away from its bed, a coffee table placed away from the sofa, a TV on a side wall where the room has no wall facing the sofa, and fr-54's séjour, open on two sides, losing three items after two repairs. The scores look generous next to the sheets: the hand-set weights are M7's to fit. Haiku's layouts look close to Opus's at a thirtieth of the cost; `LAYOUT_MODEL` stays Opus until the ratings say otherwise. (Rated on 2026-10-30: 14 of 16 Haiku homes "I'd live with this", and the 4 Opus homes about as good, so Haiku is now the default.) Cleanup the same day: an item that hangs off another (beside, in front of, around, under) now goes in straight after it and only next to it, or is left out for a repair, never just anywhere (the drifting nightstands and coffee tables are gone: 0 of 24 drifted on the cached studio intents, against 5 before); the server answers other requests between solver tries; and `layouts:eval` reruns pay for nothing without `--yes`. Haiku again: 16/16 valid, mean score 0.88, slowest home 26 s, every item placed except two in fr-54's séjour. Sofa and TV, 2026-10-30, after Ivan saw TVs too far, off to one side or turned 90° on the sheets. Measured on the 14 living rooms with both: 4 TVs at 90° to the sofa and 2 at 34–45°, 9 more than 90 cm off the sofa's middle, 5 more than 5 m away. The intents mostly ask only for the sofa to face the TV, which the scorer gave the cosine of its angle (0.7 at 45°), and the sofa went in first with no thought for the TV. Now "facing" counts fully within 15° and not at all from 75°; a new `tv_view` feature (weight 2) wants the TV and the sofa square to each other, the TV within 30 cm of the sofa's middle and 2.2–4 m away; a sofa's spot counts a wall straight ahead to put the TV on; and the TV is offered the spot on that wall centered on the sofa. After: 12 of 14 square (fr-40's sofa now stands free, facing the TV), 7 within 30 cm of the sofa's middle (1 before), and apart from fr-27, none over 4.7 m. Two are left: fr-27, long and narrow with an opening at the far end and no wall in front of the sofa at a distance to watch from, and fr-66, whose walls are slanted. Still 16/16 valid with Haiku (mean 0.87, the stricter scoring) and 4/4 with Opus (0.90). Armchairs, the same day, after Ivan saw them far from the sofa: in the 10 living rooms with one, it stood 2.4–6.4 m from the coffee table, against some far wall, since "facing the coffee table" scores as well from across the room, and the solver only offered wall and grid spots. A new `armchairs` feature (weight 1.5) wants each armchair either in the seating group (0.9–1.9 m from the coffee table, turned to it) or in a corner of its own (a floor lamp within 90 cm or a window within 1.3 m, facing the room), and the solver offers spots at each end of the coffee table and across it from the sofa. After: 6 of 10 at the coffee table, 1.6–1.9 m from it, the other 4 by a lamp or a window. Still 16/16 valid with Haiku, mean 0.88. More than one armchair is the intent's choice, so it would take a prompt change. The sheets to rate are now `data/eval/layouts-2026-10-30T05-19-34-claude-haiku-5-5.html` and `data/eval/layouts-2026-10-30T05-20-53-claude-opus-5-5.html`.

Out of M4: swapping and regenerating one room (M5), sign-in and allowances (M6), the rating page and learned weights (M7), and L-shaped or corner furniture (§8).

### M5 — Editing (1 week)
- [x] Swap drawer: same category, footprint within tolerance, budget filter
- [x] Delete
- [x] Re-validate and re-score after every edit (the edited room, plus the whole-home checks)
- [x] Regenerate a single room while keeping the others
- [x] Undo/redo
- [x] Shopping list: the home's final items from the current layout, grouped by product with quantities, article numbers, prices, links and the total; flag items discontinued since the last scrape; copy article numbers, export CSV, print

**Done when:** on a furnished test home, every edit (swap, delete, move, one room redone, undo and redo) is checked and scored as it lands, a room redone never changes or breaks the rooms kept, and the shopping list matches what's in 3D, item for item and to the cent.

#### M5 in detail

**What's already there.** From M3: delete (the Remove button and the Delete key), undo and redo (one history for the plan and its furniture, Ctrl+Z and Ctrl+Shift+Z, 200 steps), and validation live on every drag frame, walkways included since M4. M5 adds swapping, scores and the budget after each edit, another layout for one room, the shopping list, and the "Why here?" M4 kept the intent's reasons for.

**Items keep their ref.** `Placement` gets an optional `ref`, the intent's name for the item (`sofa`, `ns_left`). The pipeline keeps it when it numbers the winner's ids, a swap keeps it, and items placed by hand have none. It ties each item to its reason and its relations, so a swapped sofa is still meant to face the TV, and a room can be rearranged from what it holds now. Placements are JSONB on both tables, so nothing migrates.

**What each room was furnished from.** Every furnishing logs whole-home layouts (M4). For each room, the latest winner whose `inputs.roomIds` include it holds the intent the room came from: its items' reasons, its relations and its share of the budget. `GET /floorplans/:id/furnishing` returns that intent per room, with the last budget and style. Rooms furnished by hand have none.

**Scores after each edit.** `scoreFurniture(plan, furniture, products, { intents, budgetCad, style })` in `packages/geometry`: `scoreRoom` for each furnished room (relations from its intent, matched by ref; none for items placed by hand) and `scoreHome` over them. It runs in the browser once an edit lands, not on drag frames, since the walkway feature is the slow one; validation stays live as in M3. The panel shows each room's score beside the one it was furnished with, and the home's total against its last budget: over budget is a warning here, since it's the user's choice. The Rooms tab marks each room's problems with a red count, so one left in another room isn't missed. The scores are a working aid on plain screens and aren't saved: M7 can work them out again from the furniture and the logged layouts.

**Swap.** "Swap" on the selected item's card (or S) lists products of the same category whose width and depth are each within 20 cm of the item's (`SWAP_TOLERANCE`, one constant; a toggle shows every size), grouped by family with the catalog's variant pickers. Each option shows its price difference ("+$120") and whether it fits where the item stands: `validateLayout` with `paths: false` for the list, and the full check for the option hovered, which is drawn in 3D in the item's place. "Within budget", on when the home has a budget, hides options that take the home over it; without one, an "Up to $" limit. A swap keeps the item's id, ref and turn, centred where it was, then snapped, so a deeper sofa keeps its back to the wall. It's one edit to undo.

**Try another layout for one room**, with the other rooms kept as they are:

| | Rearrange | New pieces |
|---|---|---|
| What changes | Where the room's items stand | What's in the room, and where |
| How | The solver again on the items the room holds now and its intent's relations, with 8 new seeds | One LLM call for this room only, with the rooms kept described for their style, then the solver as in M4 |
| Cost and time | Free, a few seconds | About a third of a home's intent: roughly $0.03–0.08 on Opus 5.5, under a cent on Haiku 5.5; under 30 s |
| Needs | Nothing: items placed by hand have no relations and go where their category usually does | A saved plan and `CLAUDE_API_KEY`; sign-in from M6 |

Both go through M4's pipeline. `generateHome` gains `keep`, the other rooms' furniture, which every room is solved around and which never changes. New items get ids after the home's existing ones, not `f1` again. The home is checked whole before anything ships, but only problems the new room causes fail it: one the user left in another room doesn't. Rearrange draws its seeds at random and logs them, and a candidate that leaves every item within 10 cm of where it stands doesn't count as another layout. New pieces' budget defaults to the room's share in its last intent (or what's left of the home's budget), and its must-haves to the categories the room holds now; both can be changed, as in Furnish for me. Furnishing a whole home keeps prompt `layout-intent.v1` as it is, so `layouts:eval`'s cached intents stay valid. One room adds a short second prompt, `layout-room.v1`: match the rooms kept, keep to the room's budget, and try something other than what's there. Both versions are logged.

Every candidate is logged as in M4, as a whole home: the rooms kept as they stood, plus the room redone. `inputs.roomIds` names the room, and `llmIntent` holds the mode and seeds (no model or usage for a rearrange). The winner becomes `furnishedFrom`. A layout row is always a whole home, so M7 can tell which generation each room came from, and what the user changed since.

While a room is being redone, the furniture is read-only (no dragging, keys or placing, with a note saying why), so the result can't clash with an edit made meanwhile. The app saves before it asks, so the server solves around what's on screen. The result replaces the room's items as one edit to undo.

**Delete, undo and redo.** × on each item in the room's list, and "Clear the room" as one step. Undo and Redo move to the panel's header, on both tabs, and grey out when there's nothing to undo or redo. Every furniture edit is one step, with store tests: place, move, turn, swap, remove, clear a room, a room redone, and Furnish for me.

**Shopping list** at `/plans/:id/list`, linked from the home's panel, the demo's included. One row per product: picture, name and variant, article number, the rooms it's in, quantity, unit price, line total and IKEA.ca link; then the item count and the total. Products IKEA has dropped since the last scrape are flagged ("No longer sold: swap it", linking back to the item in 3D), and so are article numbers the catalog doesn't have. Prices carry the date of the last scrape and "check before buying". Copy puts one line per product on the clipboard (`900.000.10 × 2  TEST sofa, grey`). Export downloads a CSV, UTF-8 with a byte order mark so Excel shows "Ö", with names quoted. Print uses a print stylesheet without the buttons. The list's logic is pure functions in `apps/web/src/shopping.ts`, with tests.

**The screens** stay plain, as in M3 and M4: the user-facing design comes later, from `docs/frontend-design.md`.

**Steps,** each one commit or two, and demoable:

1. **Refs:** `Placement.ref`, kept by the pipeline. Commit `feat(schema): keep each item's ref from the intent`.
2. **What each room was furnished from:** `GET /floorplans/:id/furnishing`, tested on logged layouts of two generations: a whole home, then one room redone. Commit `feat(api): what each room was furnished from`.
3. **Why here:** the app loads it with the plan, and the item card shows the item's reason; items placed by hand show none. Commit `feat(web): say why each item is there`.
4. **Scores after each edit:** `scoreFurniture`, with tests (a swap that breaks a relation scores lower; a room furnished by hand is scored without relations). Then the room scores, the budget line and the problem counts on the room list. Commits `feat(geometry): score a furnished home`, `feat(web): score the home after each edit`.
5. **Delete, undo and redo:** the buttons, Clear the room, and the store tests. Commit `feat(web): undo, redo and delete on every tab`.
6. **Swap:** `swapOptions` in `catalog.ts` (category, size tolerance, budget), with tests; the `swapItem` store action; `Preview.articleNo`, so the option hovered is drawn and checked in place; then the list. Commits `feat(web): swap an item for a like one`, `feat(web): swap list`.
7. **One room again, on the server:** `generateHome` with `keep` and the mode, the `layout-room.v1` prompt, and `POST /floorplans/:id/rooms/:roomId/layouts` with `{ mode, budgetCad?, mustHaves? }`, answered through the same `GET /generations/:id`. Tests with a fake LLM: the rooms kept come back untouched, no ids collide, a problem left in a kept room doesn't fail the room redone, and a rearrange makes no LLM call. Commit `feat(api): furnish one room again`.
8. **One room again, in the app:** "Try another layout" on the room's Furnish tab, with both choices and what each costs, progress, the furniture read-only while it runs, and the result as one step to undo. Commit `feat(web): try another layout for a room`.
9. **Shopping list:** the page, and `shopping.ts` with tests (grouping, quantities, totals to the cent, the flags, CSV quoting). Commit `feat(web): shopping list`.
10. **Done check:** in headless Chromium, on fr-56 as Opus read it (saved in M3) and on the demo. Swap the sofa and a nightstand, once for one that fits and once for one that doesn't; delete an item and clear a room; undo and redo all of it; rearrange the bedroom; get new pieces for the séjour once (paid, with the estimate first, under $0.10); and check the shopping list and its CSV against what's in 3D.

    Done on 2026-10-29, in headless Chromium against a dev server. On fr-56: the sofa swapped for one that fits (no problems), a nightstand for a tray table that doesn't (red, "overlaps the dresser"); an item deleted and the bedroom cleared; four undos brought back exactly the furniture it started with, and redo replayed them. Rearranging the bedroom cost nothing and took a few seconds, the séjour untouched. New pieces for the séjour took 18 s and $0.07 on Opus 5.5: seven new items with their refs and reasons, ids after the home's (f12 on), the bedroom untouched, every item valid, the room at 0.86. The shopping list and its CSV matched what's in 3D, 11 items to the cent; Copy and Print work, and an item IKEA drops is flagged with what it adds to the total. On the demo, which isn't saved, editing and the shopping list work and "Try another layout" isn't offered. `layouts:eval` from cache gives the same 16 homes as before, to the score. What the check changed:

    - **A rearrange moves the room and keeps everything.** The solver has `avoid`, spots items must leave, and `placeAll`, which puts an item with no room by its anchor elsewhere rather than leaving it out. A rearrange makes the room's largest piece that stands on its own (usually the bed or sofa) leave its spot, so it is another layout every time, and fails, leaving the room as it was, if anything would be left out. Before, a nightstand could be dropped, and a rearrange could come back exactly as it was.
    - **Items without a ref** (placed by hand, or furnished before M5) take the ref of a product the room's last intent chose that they are, so they get their relations and reasons back.
    - **A rearrange doesn't replace a room's intent:** it chose no pieces, so `GET /floorplans/:id/furnishing` keeps the intent the pieces came from.
    - **A furnishing is followed from the home page,** not the panel that started it, so changing rooms or tabs while it runs doesn't lose the result. One runs at a time per home (409 otherwise), the furniture is read-only meanwhile, and the result goes in only if the same home is still open.

    Known limit: in a small room there are few good spots, so rearranges alternate between two or three, and the one forced away from the best can score lower (fr-56's 3.0 × 2.8 m bedroom: 0.72 against 0.82, with a nightstand in the corner). The score says so, and Ctrl+Z puts it back.

Out of M5: sign-in and allowances (M6), the rating page and learned weights (M7), a cart on IKEA.ca (§8), live prices (the weekly scrape stays), and wall-mounted items.

### M6 — Accounts (1 week)
Sign-in exists only to limit token use per account.
- [x] Sign in with Supabase Auth (Google or an email link), asked for only before a step that calls an LLM: reading a plan, furnishing, new pieces for a room. Everything else works signed out, rearranging a room included (it makes no LLM call)
- [x] The API verifies the Supabase session token on every route that calls an LLM
- [x] A `usage` row per LLM call: account, route, model, input and output tokens, cost. Cached readings cost nothing
- [x] A daily spending allowance per account, from config. At the limit, LLM routes refuse with a reason code; manual editing keeps working
- Homes aren't tied to accounts: they autosave as they do today.
- The browser still talks only to our API, so the tables stay closed to Supabase's public Data API (RLS on, no policies).

**Done when:** signed out, no step can call an LLM; an account at its allowance is refused until the next day, while editing still works.

#### M6 in detail

**What calls an LLM today.** Reading a plan (`POST /floorplans/:id/read`, which the app starts by itself after an upload), furnishing a home (`POST /floorplans/:id/layouts`), and new pieces for a room (`POST /floorplans/:id/rooms/:roomId/layouts` with `new_pieces`). A rearrange, uploading, editing, swapping and the shopping list call none, and stay open to everyone. The eval CLIs call the APIs directly, not through these routes, and print their own costs; they aren't accounts and aren't counted.

**Signing in.** In the browser with `@supabase/supabase-js`, from the project's URL and its publishable key (public by design). Two ways: an email link (on by default; Supabase's built-in email sends only a few an hour, enough for a personal project, and a custom SMTP server lifts that later), and Google (an OAuth client from Google Cloud, entered in the Supabase dashboard). supabase-js keeps the session in the browser and refreshes it. The browser talks to Supabase only to sign in: data still goes through our API, and the tables stay closed to Supabase's Data API (RLS on, no policies, as every table has now).

**Checking a session.** The app sends the access token as `Authorization: Bearer …` on the routes above. The API checks it itself with `jose`: signed by one of the project's keys (fetched once from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` and cached), issuer `${SUPABASE_URL}/auth/v1`, audience `authenticated`, not expired. That needs the project's asymmetric JWT signing keys, the default for new projects; on an older project they're turned on once in the dashboard, and the API says so at startup if the key set is empty. The account is the token's `sub`, a Supabase user id; homes still aren't tied to it. The check is injected like the reader and the writer, so tests run without Supabase. Without `SUPABASE_URL`, those routes are refused, unless `AUTH=off`, for local development only: it's logged at startup, every call counts against one local account, and the API won't start with it in production.

**Usage.** A `usage` table (RLS on, no policies, never deleted): one row per request that calls an LLM, with the account, the route, the floor plan, the model, input and output tokens (a furnishing's repairs included), the cost in dollars, whether it was cached, and whether it succeeded. Readings get the reading cache `plans:eval` already has: a plan's first reading of an image read before, by the same model and prompt, comes from the cache, costs nothing and is logged at $0; "Read it again" always asks afresh, since a second reading is the point of it. A call that fails still costs what it used: the reader's and the writer's errors carry the tokens spent so far. Gemini's free tier is logged with no cost, and costs nothing against the allowance; its own 20 reads a day per model are shared by everyone.

**The allowance.** `DAILY_ALLOWANCE_USD` per account (default $1.00: about ten Opus readings, or a hundred and more furnishings on Haiku), counted by calendar day in `ALLOWANCE_TIME_ZONE` (default `America/Vancouver`). A request goes ahead only if what the account spent today, plus what one such request usually costs on the configured model, stays within it, so a day can't run far over. One LLM request per account at a time, so two can't both slip under the limit. The refusals carry a reason code the app turns into words:

| Code | Status | When | The app says |
|---|---|---|---|
| `sign_in_required` | 401 | No token, or one that doesn't check out | Sign in to have the AI do this (and it shows how) |
| `allowance_reached` | 429 | Today's spend plus one more would pass the allowance | You've used today's AI allowance; it's back at midnight. You can still edit by hand |
| `busy` | 409 | The account has an LLM request running | Wait for the one under way |
| `auth_unavailable` | 503 | Sign-in isn't set up on the server | AI steps aren't available here |

`GET /me` (signed in) answers the account's email and today's spend, allowance and reset time, for the app to show.

**In the app** (plain screens, as before): a sign-in panel with an email field and a Google button, shown in place of an AI step's button when signed out: in the editor after an upload ("Sign in to have the plan read for you, or trace it yourself"), in Furnish for me, and in New pieces. An email link or Google brings the user back to the same page, signed in, and the step can go ahead; an upload waiting to be read is read then. A line in the home panel and on the plans page: "Signed in as … · AI today: $0.12 of $1.00 · Sign out". Vite reads the repo's `.env` (`envDir`), where only the `VITE_` settings reach the browser.

**Setup, yours, once** (written into `.env.example`): in the Supabase dashboard, Authentication: Email on, Google added with an OAuth client from Google Cloud, the site URL `http://localhost:5173` and the redirect URL `http://localhost:5173/**`; JWT signing keys on if they aren't. Then `SUPABASE_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`.

**Steps,** each one commit, and demoable:

1. **Settings:** the config (`SUPABASE_URL`, `AUTH`, `DAILY_ALLOWANCE_USD`, `ALLOWANCE_TIME_ZONE`), the web's `VITE_` settings and `envDir`, and `.env.example` with the setup above. Commit `chore: settings for sign-in and the ai allowance`.
2. **Checking a session:** `apps/api/src/auth.ts`, the `jose` check and middleware that sets the account or refuses with `sign_in_required`. Tested against a key pair made in the test, served as a local key set: a good token, an expired one, one from another issuer, a tampered one, none. Commit `feat(api): check supabase sessions`.
3. **Usage:** the `usage` table and migration, `recordUsage`, the reader's and writer's errors carrying their usage, and the reading cache in the read route. Commit `feat(api): log what every llm call costs`.
4. **The allowance:** the start of the day in a time zone (tested across the change to and from daylight time), today's spend, the estimate per route, one request at a time, the refusals, and `GET /me`. Commit `feat(api): a daily ai allowance per account`.
5. **The routes:** reading, furnishing and new pieces need an account, are checked against the allowance, and log their usage, failures included; a rearrange stays open. Tests with a fake reader and writer that count their calls: signed out, none is called. Commit `feat(api): sign in before anything that calls an llm`.
6. **Signing in:** `auth.ts` in the app (the client, the session, sign in by email or Google, sign out), the sign-in panel and the account line. Commit `feat(web): sign in with an email link or google`.
7. **AI steps signed in:** the token on the LLM calls, the sign-in panel in place of each AI step when signed out, an upload's reading held until sign-in, and each refusal in words. Commit `feat(web): ask to sign in before ai steps`.
8. **Done check:** you sign in once by email link and once by Google, in your browser. In headless Chromium, signed out: uploading, editing, furnishing by hand, swapping, rearranging and the shopping list all work, each AI step shows the sign-in panel, and the API logs no usage. Signed in (if you add a secret key to `.env` for the check, a sign-in link made with Supabase's admin API, else in your browser): a reading with Gemini (free) and new pieces for a room with `LAYOUT_MODEL=claude-haiku-5-5` (under a cent) each log a usage row with its tokens and cost, and the account line shows them. With `DAILY_ALLOWANCE_USD=0`, every AI step is refused with `allowance_reached` while editing still works; the next day's reset is covered by the tests with a fixed clock.

    Partly done on 2026-10-29, before the dashboard setup. Steps 1–7 are built and pushed, with `usage` migrated to the dev database. Signed out, in headless Chromium with placeholder Supabase settings (so the app behaves as if sign-in were set up): the plans page offers sign-in; "Read the plan again", Furnish for me and New pieces each show the sign-in panel and send nothing; a rearrange works; editing works; the usage table stays empty. With `AUTH=off` and `DAILY_ALLOWANCE_USD=0`: reading, furnishing and new pieces are each refused with "You've used today's AI allowance ($0.00). It's back at midnight; you can still edit by hand", editing still works, nothing is logged, and `GET /me` answers the local account at $0 of $0. Signed in on 2026-10-30: Ivan set up the dashboard and signed in with an email link and with Google; the project publishes its signing key, so the API checks sessions against it, and Supabase now sends Google sign-ins to Google with the right callback. Not yet seen live: a signed-in AI step's usage row, which the tests cover; the first one appears in the account line as "AI today: …". Two things found on the way: `jose` and `supabase-js` are pinned to releases at least two weeks old (6.2.12 and 2.118.0); and in the platform's time zone data Vancouver keeps daylight time after March 2026, so the allowance's day there is always 24 hours (the 23- and 25-hour days are tested on New York).

Out of M6: homes tied to accounts (they stay unowned until a pass is bought, §8), payments, password sign-in, a page to see everyone's usage, rate limits beyond the allowance, and deploying (CORS, production redirect URLs).

### M7 — Feedback loop (1–2 weeks)
- [x] Internal `/admin/rate` page, for admins only: one room from two layouts side by side in live 3D, with the real models, colors and textures and the two cameras linked. Pick the better one or "about the same", say whether you'd live with it, flag items in a bad spot, and say why in your own words
- [x] Natural-language feedback as training data: every note is read into labels (which items, what's wrong, which scorer feature it bears on), and "Tell it" turns a note into a revised layout of the room to rate against the original
- [x] A pool of the test homes to rate, furnished from cached intents at no LLM cost, and pairs picked to teach the scorer the most
- [ ] Rate 100+ pairs
- [ ] First `ml/` fit: Bradley–Terry on scorer features → `weights.json`, kept only if it agrees with your ratings better than the hand-set weights on held-out homes
- [ ] Lessons and few-shot: rules drawn from your notes, and top-rated rooms as examples, in `layout-intent.v2`, kept only if it wins a blind comparison
- Screenshots move to the vision judge (§7): rating happens in live 3D, so nothing needs pictures yet.
- Waiting for M7's ratings (Ivan, 2026-10-30): placements the ratings should settle, and whether to ask the intent for a second armchair (a pair across the coffee table, or one in a reading corner with a floor lamp by a window) in living rooms over about 20 m². The intent always asks for one today; testing the change is about $0.06 on Haiku. Learned weights only re-weigh what the scorer measures, so the rating notes say which problems need a new feature first.

**Done when:** 100+ pairs are rated on the 3D page, every note is read into labels you've checked, and the fitted weights either beat the hand-set ones on held-out homes and win a blind check of 20+ rooms, or this section records why they weren't shipped. The same goes for `layout-intent.v2`. `layouts:eval` stays 16 of 16 valid.

#### M7 in detail

**What's already there.** Every furnishing logs every candidate (M4): best-of-8 whole homes, each with its intent, seeds and prompt version. The `ratings` table exists (two layouts, a winner, a note) and is empty. The dev database holds one furnished home, fr-56, with 125 layouts, most from rearranges. The 16 test homes `layouts:eval` furnishes (50 rooms) exist only as files. Their intents are cached: Haiku for all 16, Opus for 4. `scoreRoom` weighs ten features with hand-set weights from `weights.json`. Those weights steer where things go, not only which candidate wins: as the solver places each item, it ranks every spot by the room's score. So weights fitted to your ratings change placements directly. `HomeScene` already draws a home in 3D with the real models, but it's tied to the editing store.

**What learns from what:**

| You give | It becomes | It changes |
|---|---|---|
| A pick between two layouts of a room | A pair for the Bradley–Terry fit | The scorer's weights, so where the solver puts each item and which candidate wins |
| A note in your own words, on the room or on one item | Labels: the items, what's wrong, the scorer feature it bears on (or none), a rule if it implies one | Lessons in the intent prompt (what goes in a room, roughly where); new scorer features where no feature measures the problem |
| "Tell it" what to change | A revised layout of the room, and your pick between it and the original | Another pair for the fit, and an example of how words map to the intent |
| Whether you'd live with it | The quality measure, per room | Which rooms are top-rated examples for the prompt |

**The pool.** `pnpm ratings:pool [--seeds 12] [homes...]` adds each test home to the database once, as a floor plan with `source: 'test_set'` and its name (fr-12). It goes in without its image: dataset samples stay on disk. Then it furnishes each home from cached intents only (Haiku for all 16, Opus for the 4 it has) with 12 seeds, and logs every candidate as a furnishing does. It never asks the LLM: a home with no cached intent is skipped. It's free and takes about a minute, and a rerun adds candidates with new seeds. The plans page hides test-set homes. 50 rooms with 12 versions each (plus Opus's 14 rooms) is far more than 100 pairs need.

**Picking pairs.** `GET /admin/ratings/next` picks:

- the room with the fewest ratings first, so all 50 get some;
- two versions of it from logged layouts, never a pair rated before. Versions that differ by under 10 cm and 15° on every item in the room count as one;
- for most pairs, two versions from the same intent, so only placement differs. About one in four compares intents (Haiku against Opus now, v1 against v2 later): what's in the room as well as where;
- for most pairs, versions whose room scores are within 0.1 of each other, since those teach the fit the most. About one in five is far apart, as a check that the scorer is right when it's sure;
- a random side for each version. The left one is stored as `layoutA`, so a lean to one side shows in the tally.

Room scores come from `scoreRoom` with the logged intent's relations, cached in memory by the API.

**The rating page** at `/admin/rate`, linked from the plans page for admins (plain screens, like `/catalog`; the brief leaves internal pages out). Two 3D views sit side by side, each with only the rated room's furniture, the walls cut away as in the home view, and the same lighting. Orbiting one moves the other. Keys 1–3 give the corner views and T the view from above. Hovering an item shows its name, color, size and price. Nothing shows a score, model, prompt version or weight set until you've picked.

1. **Pick:** A, B, or S for about the same.
2. **Would you live with it** (the one picked, or both when they're the same): Y or N.
3. **Say why** if you want to. The note box takes the cursor after the pick. Click an item on either side to flag it as in a bad spot, with its own one-line note ("too far from the sofa"). Room-wide problems are a few toggles: too full, too empty, hard to walk through, blocks a window, needs more seating, pieces don't go together.
4. **Enter saves.** The page then shows what the scorer would have picked and the features that differ most between the two. A few seconds later it shows how your note was read. N goes to the next pair. Backspace takes back the last rating: it's archived, never deleted.

The header keeps a tally: pairs rated, how often the scorer agrees with you, and how often the left side wins. A pair takes about 20–30 s, more with a note, so 100 pairs is about an hour, in as many sittings as you like.

**Notes in your own words.** Every note (a room's, or an item's) is read by the layout model (Haiku 5.5 by default) with a new prompt, `rating-note.v1`, into structured labels, one per problem it names:

- the side and the items (by placement);
- what's wrong: too far from, too close to, facing away from, blocks, against a window, off-center, wrong size for the room, missing, not needed, style, or other;
- the item it's relative to, if any;
- the scorer feature it bears on: one of the ten, or none;
- a general rule in plain words, if the note implies one ("an armchair belongs within reach of the sofa, or by a lamp").

The labels are saved on the rating with the model and prompt version. The page shows them, and you can correct one with a click: a wrong item, a wrong feature. Notes are kept exactly as written, so a later prompt can read them again. Reading one costs a fraction of a cent and is logged in `usage` against your allowance (route `read_note`).

**Tell it.** "Tell it" on either side takes what should change, in words: "move the armchair beside the lamp by the window", "TV straight across from the sofa". The layout model gets the room's intent and your words, with a new prompt, `revise-room.v1`. It returns a revised intent for that room: relations, reasons, and which of its items stay. It adds no new products and never gives coordinates (the architecture principle holds). The solver places the revision with the original's seeds, `validateLayout` checks it like any layout, and it replaces that side. You then pick between the original and the revision as for any pair. That's saved as a rating with `source: 'told'` and your words as its note. The revision is logged as a candidate (`llmIntent.mode` `revise`, with the original as its parent). When the room can't do what you asked (no lamp to sit by), it says so instead of pretending, and that's a label too. A try is under a cent on Haiku and takes 5–10 s.

**Fitting the weights.** `pnpm ratings:export` writes `data/ml/ratings.csv` (gitignored): one row per active rating. Each row has both sides' room features, worked out again by today's `scoreRoom`, since the logged breakdowns are whole-home and some come from older scorers. It also has the pick, whether you'd live with it, the source, the home and the labels. The notes go to `data/ml/notes.jsonl`.

`ml/fit_weights.py`, with a notebook that walks through it, fits Bradley–Terry as a logistic regression on feature differences: P(A beats B) = σ(Σ wₖ(fₖᴬ − fₖᴮ)).

- Weights stay ≥ 0 and are pulled toward the hand-set ones (L2 toward them, not toward zero), so a hundred pairs nudge the weights rather than replace them.
- "About the same" counts as half a win each way.
- The check is cross-validation grouped by home, so a home's pairs are never in both training and test. It compares the accuracy and log loss of the fitted and hand-set weights on held-out homes, with bootstrap ranges per weight.
- It writes `weights.json` (scaled to the same total, with `source` saying when, from how many ratings, and both held-out accuracies) only if the fitted weights do better on held-out homes. Otherwise it reports and leaves the file alone.
- The report sets each feature's change beside how often your notes blame it, and lists the problems your notes name that no feature measures.

The home weights (rooms, style, budget) stay hand-set, since room-level pairs say nothing about them.

**Lessons and examples.** `pnpm ratings:lessons` sends the notes and their labels (text only) to the layout model. It proposes up to ten lessons, each a rule in plain words with the ratings it rests on, and each marked as about what goes in a room or where exactly. You keep, edit or drop each one:

- Kept lessons about what goes in a room, and roughly where, go into `layout-intent.v2` as a short section. They're your rules in plain words, with no catalog data, so the prompt file is committed as usual.
- Lessons about exact placement that no feature measures become up to two new scorer features. Each is code with a Vitest test and a check on the test homes, and then the weights are fitted again.

v2 also gets up to three top-rated rooms of the same type, from other homes, as examples. They're chosen from the ratings when an intent is asked for: rooms you'd live with that win most of their pairs. Each example gives the room's items, relations and reasons, never coordinates. Their layout ids are logged with the intent. The second armchair is decided here, from your armchair notes on larger living rooms: if they ask for it, it's a lesson.

**Who can rate.** `ADMIN_EMAILS` (comma-separated) in `.env`. The admin routes need a signed-in account whose email is on it, and refuse others with `admin_only` (403). With `AUTH=off`, the local account is an admin. `GET /me` says whether you're one, so the plans page shows the link.

**Cost.** Rating, the pool, picking pairs and fitting are free. The paid steps, all on Haiku:

- reading notes, about $0.0005 each;
- Tell it, under a cent a try;
- the lessons, a few cents;
- v2 on the 16 homes, about $0.10.

All of M7 comes to about $0.30–0.50 of the roughly $1.40 left on the Claude key. The page's calls count against your daily allowance and show in `usage`. The CLIs print an estimate and stop until `--yes`.

**Steps,** each one commit or two, and demoable. You can start rating once step 6 lands; notes saved before step 7 are read when it lands.

1. **Settings and schema:**
   - `ADMIN_EMAILS`;
   - `Rating` by room: `roomId`, `accountId`, winner `a`, `b` or `same`, `livable`, `note`, `itemNotes`, `tags`, `labels`, `source` (`pair` or `told`), `seconds`;
   - `floorplans.source`, the refusal `admin_only`, the LLM routes `read_note` and `revise_room`, and `Me.admin`;
   - migration `0009`. The ratings table has no rows, so nothing moves.

   Commit `feat(schema): rate one room at a time, with notes`.
2. **Admin routes:** `requireAdmin`, tested for signed out, a non-admin, an admin and `AUTH=off`. Commit `feat(api): admin-only routes`.
3. **The pool:** `ratings:pool`, the test homes added once, cached intents only, and the plans page without them. Commit `feat(api): a pool of test homes to rate`.
4. **Pairs and ratings:**
   - `pickPair`, a pure function, tested: the fewest-rated room first, never a pair twice, near-identical versions merged, the mix of same and different intents and of close and far scores;
   - `GET /admin/ratings/next`, `POST /admin/ratings`, `POST /admin/ratings/:id/archive` and `GET /admin/ratings/summary`.

   Commit `feat(api): pick pairs to rate and save ratings`.
5. **A view that only shows:** `HomeView` split out of `HomeScene`, taking its furniture as props instead of from the store, with `HomeScene` built on it; then the linked cameras and the preset views. Commit `refactor(web): a home view for showing, not editing`.
6. **The rating page:** the two views, the keys, flags and toggles, the note box, the reveal, undo and the tally. Commit `feat(web): rate two layouts of a room in 3d`.
7. **Reading notes:** `rating-note.v1` and its writer, tested with a fake client (a note naming two items, a note with no problem in it, a malformed answer asked again once), and the labels on the page, correctable. Commits `feat(api): read rating notes into labels`, `feat(web): show how a note was read`.
8. **Tell it:**
   - `revise-room.v1`, `reviseRoom` in `generate.ts` and `POST /admin/rooms/revise`;
   - tests with a fake LLM: no new products, no coordinates taken, the same seeds, the other rooms untouched, and an impossible ask answered as such;
   - the button.

   Commits `feat(api): revise a room from a note`, `feat(web): tell it what to change`.
9. **You rate** 100+ pairs. After about 30, a checkpoint: the tally, how the notes were read, and the scorer's agreement. I adjust the pair mix or the note prompt if needed.
10. **Export and fit:** `ratings:export`, `fit_weights.py` and the notebook, and the report. Commits `feat(api): export ratings with scorer features`, `feat(ml): fit scorer weights to ratings`.
11. **Learned weights in:**
    - `scoreRoom`, `solveRoom` and `generateHome` take `weights` (by default `weights.json`);
    - `ratings:pool --compare` furnishes each test room from the same intents and seeds with both weight sets, and the page serves those pairs blind. You rate 20+;
    - the fitted weights ship only if they win more than they lose, with `layouts:eval` from cache still 16 of 16 valid.

    Commits `feat(geometry): score with given weights`, then `feat(geometry): weights fitted to ratings` if they ship.
12. **Lessons, new features and v2:**
    - `ratings:lessons`, which you go through;
    - up to two new features, then a refit;
    - `layout-intent.v2` with the lessons and examples, and the 16 homes on Haiku with an estimate first;
    - 20+ blind pairs of v1 against v2. v2 becomes the default only if it wins.

    Commits `feat(api): lessons from rating notes`, `feat(geometry): …` for each feature, `feat(api): layout-intent.v2 with lessons and examples`.
13. **Done check:** the numbers above, written into this section.

    Built on 2026-10-30: steps 1–8, 10 and 11's tools, and step 12's lessons tool. Each was checked in headless Chromium against a throwaway API over an in-memory database, so the dev database holds no test ratings. Three live calls on Haiku 5.5 came to $0.0013 in all:

    - **Reading a note:** "the coffee table is way too far from the sofa, and the TV is off to the side" became two labels, `too_far_from` → `relations` and `off_center` → `tv_view`, each with a fitting rule. $0.0003, 8 s.
    - **Tell it:** in fr-40's living room, "put the armchair right next to the sofa, facing the coffee table" added `beside` the sofa and kept every other relation. The armchair moved from 2.48 m to 1.38 m from the sofa, and the home stayed valid. $0.0008, 10 s.
    - **Lessons:** two notes about a stranded armchair became one lesson backed by both. $0.0002.

    **The pool:** all 16 test homes, 249 layouts, 49 rooms. Most homes logged 12 layouts a model; a multi-room home logs only the seeds whose rooms stand together, so Opus's fr-12 logged 2.

    What changed from the plan on the way:

    - **The pool is the test homes only.** An uploaded home's plan can be edited after its layouts were logged.
    - **Tell it lives in the reveal,** after a pair is rated. It starts on the side not picked, with the note's words.
    - **The page's AI requests go one at a time.** The API allows an account one AI request at a time, so Tell it pressed while a note was still being read had been refused as busy.
    - **Fitted weights are kept apart.** `fit_weights.py` writes them to `data/ml/weights-fitted.json`. `pnpm ratings:pool --compare data/ml/weights-fitted.json` furnishes the test homes with both weight sets, from the same intents and seeds, for the blind check at `/admin/rate?compare=weights-fitted`. `--ship` then writes `weights.json`, only if the fitted weights also did better on held-out homes.

    **Still to do:**

    - Ivan: `ADMIN_EMAILS` in `.env`, then 100+ ratings (step 9), the blind checks, and going through the lessons.
    - Then `layout-intent.v2`, its lessons and examples wired into the intent writer once there are lessons to keep, and the numbers here.

Out of M7: the learned reward model (LightGBM, after several hundred pairs, §7), the vision judge and its screenshots, users' own edits as signals (§7), dragging items to fix a layout on the rating page, voice notes, rating by anyone but admins, fine-tuning, and the user-facing design (M8).

### M8 — Front end (later)
The screens people use, and a landing page, designed with Claude Design from `docs/frontend-design.md`. Until then, every milestone's screens stay plain.
- [ ] A Claude Design pass over the brief: tokens and type, `ui/kit` primitives, and the landing page with My plans (§4.1)
- [ ] The brief's phases A–E over the app as built: reading your plan, the guided Check wizard, the workspace shell, preferences and furnishing progress, "Why here?", the swap drawer, try another layout, the sign-in dialog and daily limit, and the shopping list
- [ ] A copy pass with the brief's vocabulary (§9), and `copy.test.ts` checking for banned words
- [ ] First-time help (§5) and accessibility (§7): every action by keyboard, an axe check with no serious issues
- Internal pages (`/catalog`, `/admin/rate`) stay plain. Mobile stays out of scope.

**Done when:** the brief's definition of done (§11) holds for every screen: a first-time tester who isn't a developer goes from upload to a furnished home and a shopping list without help. Its detailed steps are written when it starts.

## 7. Feedback pipeline roadmap (post-MVP)

1. **Few-shot prompting** with top-rated layouts, and lessons from your rating notes (M7)
2. **Best-of-N reranking** with the learned weights
3. **Learned reward model** (LightGBM → ONNX → onnxruntime-node) once there are several hundred comparisons
4. **Vision judge:** score screenshots (taken from fixed angles by the rating page's 3D views) against a rubric drawn from the lessons, measure agreement with your ratings
5. **Implicit signals:** user keeps, swaps, and deletes as training data
6. **Fine-tuning** only with thousands of high-quality examples

Prior work to read: 3D-FRONT dataset (research license), ATISS, LayoutGPT, Holodeck.

## 8. Future goals (post-MVP)

- **L-shaped, T-shaped and corner furniture.** Corner and chaise sofas (about half of IKEA's sofas), L-shaped desks, KALLAX desk combinations, corner wardrobes and bookcases. They need non-rectangular footprints in `packages/schema` and `packages/geometry`, left- and right-hand variants, and models to match. Revisit once M4 meets the quality bar with rectangular footprints.
- **One-click IKEA cart.** Add the shopping list to the user's own IKEA.ca cart. IKEA has no public cart API, and its cart needs IKEA's session tokens, so the API never calls it (no credentials, §Scraper in `CLAUDE.md`). Instead, a browser extension or bookmarklet runs on ikea.ca in the user's own session and adds the items there. It breaks when IKEA's site changes, so the shopping list stays the fallback. Check IKEA's terms first.
- **Pricing and payment.** Only after a public launch is cleared: charging money needs IKEA's permission or a licensed product and model source, since today's catalog is for personal and portfolio use. Price per home, not per token or per month, since people furnish a home once and then not for years:

  | Tier | What you get | Price (CAD) |
  |---|---|---|
  | Free | 1 home: one plan reading, a few furnishings, unlimited editing and shopping list | $0 |
  | Home pass | 1 home for 60 days: more furnishings and "try another layout" per room | ~$9–15 one-time |
  | Pro (later) | Realtors, stagers, property managers: a number of listings a month, clean renders for listings | ~$30–60/month |

  Set the free allowance and the pass price from M6's `usage` costs per home once M4 runs. Payments through **Stripe Checkout**: the API creates a Checkout Session for the account and home, Stripe's hosted page takes the card (card data never reaches our servers), and a signature-verified webhook records the purchase. A `purchases` table (account, home, tier, Stripe ids, status, never deleted) grants the pass, and the M6 allowance check reads it. A pass is per home, so a paid home gets an `ownerId`; homes stay unowned until then (M6). Pro uses Stripe subscriptions and the Customer Portal. Prices and keys come from config; build and test only with Stripe's test-mode keys until launch.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Captured GLBs have inconsistent scale, orientation, or size | Normalize everything in M1; procedural fallback so no product is blocked |
| Layouts are valid but ugly | Scorer and ratings exist for this; iterate on scoring rules more than prompts |
| Vision extraction fails on some plan styles | The correction editor is the safety net; don't chase full automation |
| Reading plans costs money (Opus, about $0.09 a plan) | Readings are cached by image, model and prompt; `plans:eval` prices every run; Gemini's free tier is the fallback; sign-in and a daily allowance per account (M6) |
| Room boundaries are ambiguous in open-plan homes | Ask the model for the boundary between labels; the editor makes splitting and merging rooms quick |
| Wrong scale silently ruins every clearance check | Plausibility checks on units, a stored residual for every scale, and labels always checked against calibration (§5.1) |
| Listed areas include walls, closets, or balconies | The area calibration UI asks what the figure covers; area plus a side catches the mismatch |
| Multi-room plans make generation slow or expensive | One intent call for the home (about $0.08–0.27 on Opus, under $0.01 on Haiku), then rooms solved in seconds; regenerate one room at a time when editing |
| IKEA.ca structure changes and breaks the scraper | Prefer JSON endpoints; snapshot tests on saved responses; alert on scrape failures |
| IKEA terms of service and model licensing | Personal and portfolio use only; revisit before any public launch |
| Multi-room work delays a usable studio flow | Build and test M2–M4 on studios first, then multi-room plans; studios stay a first-class case |

## 10. First week

1. Set up the monorepo and CI (lint, typecheck, Vitest).
2. Write the zod schemas.
3. Collect the test floor plans.
4. Sofa spike: scrape, normalize, and render one sofa at true scale.
