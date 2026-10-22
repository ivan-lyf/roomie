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
- Sign in to save rooms and layouts and reopen them later (M6)

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
Floorplan { id, name, walls: Wall[], openings: Opening[], rooms: Room[], obstacles: Obstacle[], labels: PlanText[], scale: Scale, ceilingHeight, ceilingHeightSource: 'user' | 'plan' | 'default', sourceImageUrl }
Room      { id, name, roomType, boundary: Vec2[], labelTextIds: string[], furnishable, ceilingHeight?, materials }
Wall      { id, a: Vec2, b: Vec2, thickness, height }
Opening   { id, wallId, kind: 'door' | 'window' | 'passage', offset, width, height, sillHeight?, swing? }
Obstacle  { id, kind: 'counter' | 'appliance' | 'closet' | 'column' | 'radiator' | 'fireplace' | 'other', polygon: Vec2[], height? }
PlanText  { id, text, bbox, kind: 'room_label' | 'dimension' | 'area' | 'other', parsed?: { meters?, squareMeters?, roomType? } }
Scale     { metersPerPixel, sourceUnit: 'imperial' | 'metric_m' | 'metric_cm' | 'metric_mm', method: 'labels' | 'wall_length' | 'area' | 'area_and_side', inputs, residual }
Product   { articleNo, familyId, options: { name, value }[], name, category, status: 'active' | 'discontinued', priceCad, url, imageUrl, color, material, dims: { w, d, h }, shape: 'rect' | 'round', extendedW, modelUrl, modelSource: 'ikea' | 'procedural', styleTags, scrapedAt }
Layout    { id, floorplanId, inputs, placements: Placement[], score, scoreBreakdown, llmIntent, screenshotUrls, createdAt }
Placement { articleNo, roomId, x, y, rotation }
Rating    { id, layoutA, layoutB, winner, note, createdAt }
```

Walls and openings belong to the floorplan, not to a room, so a wall between two rooms is stored once and a door between them is one opening whose swing can enter either room. A room is a polygon over the floorplan; its walls are the ones along its boundary. Open-plan areas (a living room flowing into a dining area) are separate rooms with no wall between them. `PlanText` keeps every piece of text read from the image, so a wrong room type or scale can be traced back to the label that caused it.

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
The catalog keeps **every valid product** in the MVP categories instead of a hand-picked 300–500; generation filters it for each request (M4). The full crawl found 4,146 candidates; after the category rules, **2,937 products** remain. 1,744 of them render with IKEA's own 3D model (330 KB on average) and 1,193 with a stand-in, all at their listed size. L-shaped, T-shaped and corner pieces stay out until the geometry supports them (§8).

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
- [x] Products in Postgres; the API reads them from the database (`pnpm catalog:publish`; products gone from IKEA are marked discontinued, never deleted)
- [x] Catalog viewer (category tabs, families with color and size pickers, 3D preview, IKEA model or stand-in badge) and `pnpm catalog:check`
- [ ] Models in a private Supabase Storage bucket, uploaded by `pnpm catalog:publish` and served through signed links; without storage settings the API serves them from disk
- Dropped: taking the height from the model when the listing has none. It would recover about 25 products, whose models aren't downloaded because they aren't in the catalog.
- Deferred until after M4: a weekly GitHub Actions refresh of the MVP categories. It needs model caching between runs and secrets in GitHub, and a public repo must never store IKEA data as workflow artifacts.

**Done when:** every valid product in the MVP categories has valid dimensions, price, and link, renders as its IKEA model or a stand-in, and `pnpm catalog:check` passes.

### M2 — Floorplan (3–4 weeks)
- [ ] Schema: `Floorplan` holding walls, openings, rooms, obstacles, plan text, and scale (§5); Drizzle migration and fixtures in the same change
- [ ] Floor plan upload (image or PDF)
- [ ] Vision-model extraction to Floorplan JSON in plan pixels: walls, openings, room boundaries, fixed obstacles, and every piece of text with its position. Sample furniture drawn on the plan is ignored
- [ ] Text → meaning: room labels mapped to room types (abbreviations like `BR`, `LR`, `DR`, `W/D`, `WIC`, `DN`, `ENS`, `PDR`), dimension labels attached to the room or wall they describe, area labels parsed
- [ ] Unit detection and scale from the dimension labels (§5.1), with the plausibility checks
- [ ] Calibration UI for plans without labels: wall length, area, or area plus side (§5.1); runs before the plan is converted to meters
- [ ] Ceiling height: defaults to 2.44 m when the user doesn't enter one or the plan doesn't state it (§5.1); editable for the home and per room
- [ ] 2D correction editor: drag wall endpoints, add/move/resize openings, set door swing, split/merge/relabel rooms, add/remove obstacles, recalibrate scale
- [ ] 3D render: the whole home with extruded walls, window and door cutouts, floor, ceiling toggle; a room picker that frames one room and cuts away the walls in front of it
- [ ] Wall color, floor material (3–5 textures), light warmth and intensity, per room or for the whole home
- [ ] Environment lighting, soft shadows, ambient occlusion

**Done when:** every test plan becomes a correct 3D home, with rooms labelled and scale within 3%, in ≤ 2 min of correction for a studio and ≤ 5 min for a multi-room plan.

### M3 — Manual furnishing (1–2 weeks)
- [ ] Catalog browser (filter by category, price, size)
- [ ] Place, drag, and rotate with wall snapping; an item belongs to the room it is dropped in
- [ ] Live validation: overlaps (with furniture and obstacles), clearance zones, door swing arcs on both sides of interior doors, items crossing a room boundary, highlighted in red
- [ ] Price total per room and for the whole home; product links

**Done when:** you can furnish a test room by hand and the validator catches every bad placement.

### M4 — Auto layout (3–4 weeks)
- [ ] **Scorer:** hard constraints (pass/fail) plus soft scores (focal point facing, wall alignment, circulation path from door to each zone, bed access, desk near window, symmetry, budget use)
- [ ] **Whole-home checks:** a clear path from the entrance through every interior door to each room; style consistency across rooms; total within budget
- [ ] **Solver:** turns relational intent into coordinates (greedy placement plus local random search), one room at a time; rooms only interact through shared doors, so they can be solved in parallel
- [ ] **LLM intent:** a home summary (rooms, types, sizes, how they connect), inputs, and the filtered catalog in; per room, a product list plus relational constraints out (zod-validated). One call plans the whole home, so it splits the budget and keeps the style consistent
- [ ] **Repair loop:** solver failures go back to the LLM, which picks smaller substitutes or moves budget between rooms
- [ ] **Best-of-N:** generate N candidates, return the top score
- [ ] Log every candidate (not just the winner)

**Done when:** 100% of outputs are valid on the test set and ≥ 60% pass your quality bar.

### M5 — Editing (1 week)
- [ ] Swap drawer: same category, footprint within tolerance, budget filter
- [ ] Delete
- [ ] Re-validate and re-score after every edit (the edited room, plus the whole-home checks)
- [ ] Regenerate a single room while keeping the others
- [ ] Undo/redo

### M6 — Accounts (1 week)
- [ ] Sign in with Supabase Auth (Google or an email link), asked for only when saving; everything else works signed out
- [ ] The API verifies the Supabase session token on account routes
- [ ] `ownerId` on floorplans and layouts; users only ever see their own homes
- [ ] Save a home with its current layout, rename it, delete it (a status flag, never a hard delete)
- [ ] "My homes" page that reopens a saved home exactly as it was left
- The browser still talks only to our API, so the tables stay closed to Supabase's public Data API (RLS on, no policies).

**Done when:** you can save a furnished home, sign in on another device, and reopen it unchanged.

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

## 9. Risks

| Risk | Mitigation |
|---|---|
| Captured GLBs have inconsistent scale, orientation, or size | Normalize everything in M1; procedural fallback so no product is blocked |
| Layouts are valid but ugly | Scorer and ratings exist for this; iterate on scoring rules more than prompts |
| Vision extraction fails on some plan styles | The correction editor is the safety net; don't chase full automation |
| Room boundaries are ambiguous in open-plan homes | Ask the model for the boundary between labels; the editor makes splitting and merging rooms quick |
| Wrong scale silently ruins every clearance check | Plausibility checks on units, a stored residual for every scale, and labels always checked against calibration (§5.1) |
| Listed areas include walls, closets, or balconies | The area calibration UI asks what the figure covers; area plus a side catches the mismatch |
| Multi-room plans make generation slow or expensive | One intent call for the home, then rooms solved in parallel; regenerate one room at a time when editing |
| IKEA.ca structure changes and breaks the scraper | Prefer JSON endpoints; snapshot tests on saved responses; alert on scrape failures |
| IKEA terms of service and model licensing | Personal and portfolio use only; revisit before any public launch |
| Multi-room work delays a usable studio flow | Build and test M2–M4 on studios first, then multi-room plans; studios stay a first-class case |

## 10. First week

1. Set up the monorepo and CI (lint, typecheck, Vitest).
2. Write the zod schemas.
3. Collect the test floor plans.
4. Sofa spike: scrape, normalize, and render one sofa at true scale.
