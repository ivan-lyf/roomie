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
- [ ] ≥ 60% rated "I'd live with this" on the contact sheets in `data/eval/layouts-*.html` (to do: Ivan rates them later today, 2026-10-29; not blocking M5)

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

    Run on 2026-10-29. Every winner passed `validateLayout`: 16/16 homes with `claude-haiku-5-5` (mean score 0.88, slowest home 37 s, $0.06 for all 16) and 4/4 with `claude-opus-5-5` on the demo one-bedroom, the studio, fr-12 and fr-27 (mean 0.90, slowest 66 s, $0.55, $0.08–0.27 a home). One real furnishing through the web app, of fr-56 as Opus read it, took $0.08 and gave 11 valid items for $2,054 of a $2,400 budget. Two things the runs changed: rooms open to each other share walkways, so rooms are solved one after another, each around the furniture already chosen next door, not in parallel; and polygon clipping, which throws on a rare near-degenerate shape, falls back to a sampled area. Seen on the sheets: layouts are sensible on the whole (beds against walls with nightstands either side, a sofa, coffee table and rug together), with misses still to tune: a nightstand left away from its bed, a coffee table placed away from the sofa, a TV on a side wall where the room has no wall facing the sofa, and fr-54's séjour, open on two sides, losing three items after two repairs. The scores look generous next to the sheets: the hand-set weights are M7's to fit. Haiku's layouts look close to Opus's at a thirtieth of the cost; `LAYOUT_MODEL` stays Opus until the ratings say otherwise. Cleanup the same day: an item that hangs off another (beside, in front of, around, under) now goes in straight after it and only next to it, or is left out for a repair, never just anywhere (the drifting nightstands and coffee tables are gone: 0 of 24 drifted on the cached studio intents, against 5 before); the server answers other requests between solver tries; and `layouts:eval` reruns pay for nothing without `--yes`. Haiku again: 16/16 valid, mean score 0.89, slowest home 26 s, every item placed except two in fr-54's séjour. The newest sheets are `data/eval/layouts-2026-10-29T16-57-41-claude-haiku-5-5.html` and `…T16-55-04-claude-opus-5-5.html` (the Opus one from cache, with four repairs not paid for).

Out of M4: swapping and regenerating one room (M5), sign-in and allowances (M6), the rating page and learned weights (M7), and L-shaped or corner furniture (§8).

### M5 — Editing (1 week)
- [ ] Swap drawer: same category, footprint within tolerance, budget filter
- [ ] Delete
- [ ] Re-validate and re-score after every edit (the edited room, plus the whole-home checks)
- [ ] Regenerate a single room while keeping the others
- [ ] Undo/redo
- [ ] Shopping list: the home's final items from the current layout, grouped by product with quantities, article numbers, prices, links and the total; flag items discontinued since the last scrape; copy article numbers, export CSV, print

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

Out of M5: sign-in and allowances (M6), the rating page and learned weights (M7), a cart on IKEA.ca (§8), live prices (the weekly scrape stays), and wall-mounted items.

### M6 — Accounts (1 week)
Sign-in exists only to limit token use per account.
- [ ] Sign in with Supabase Auth (Google or an email link), asked for only before a step that calls an LLM: reading a plan, furnishing, trying another layout for a room. Everything else works signed out
- [ ] The API verifies the Supabase session token on every route that calls an LLM
- [ ] A `usage` row per LLM call: account, route, model, input and output tokens, cost. Cached readings cost nothing
- [ ] A daily spending allowance per account, from config. At the limit, LLM routes refuse with a reason code; manual editing keeps working
- Homes aren't tied to accounts: they autosave as they do today.
- The browser still talks only to our API, so the tables stay closed to Supabase's public Data API (RLS on, no policies).

**Done when:** signed out, no step can call an LLM; an account at its allowance is refused until the next day, while editing still works.

### M7 — Feedback loop (1 week)
- [ ] Capture canvas screenshots (3 angles per furnished room, plus a top-down view of the home) after generation, upload to Supabase Storage
- [ ] Internal `/admin/rate` page: two layouts of the same room side by side, pick the winner, optional note (rating per room keeps comparisons small and gives more pairs per home)
- [ ] Rate 100+ pairs
- [ ] Few-shot loop: inject top-rated layouts into the intent prompt
- [ ] First `ml/` notebook: Bradley–Terry model on scorer features → `weights.json` loaded by the scorer

## 7. Feedback pipeline roadmap (post-MVP)

1. **Few-shot prompting** with top-rated layouts (M7)
2. **Best-of-N reranking** with the learned weights
3. **Learned reward model** (LightGBM → ONNX → onnxruntime-node) once there are several hundred comparisons
4. **Vision judge:** score screenshots against a rubric, measure agreement with your ratings
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
