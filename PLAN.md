# Roomie — MVP Plan

> Upload a floor plan, get a furnished 3D room with real IKEA Canada products that actually fits.

## 1. Goal

A user uploads the floor plan of **one room or a studio** and, within a few minutes, sees a **furnished, physically valid 3D room** built from real IKEA.ca products. They can edit it, and every generated layout is logged and rated so the system gets better over time.

## 2. Success criteria

Measured against a fixed test set of 10–15 real floor plans (e.g. Vancouver rental listings).

| Area | Criterion |
|---|---|
| Floor plan | Walls, doors, and windows are correct after ≤ 2 min of user correction |
| Validity | 100% of generated layouts have zero overlaps, zero blocked doors, and walkways ≥ 75 cm. Enforced by code |
| Quality | ≥ 60–70% of generated layouts rated "I'd actually live with this" |
| Speed | Generation < 60 s; 3D view stays smooth on a laptop |
| Accuracy | Every item has a working IKEA.ca link and correct price; the total adds up |
| Learning | Every layout is logged; the first 100+ pairwise ratings are collected |

## 3. Scope

**In scope**
- Single-room or studio floor plans
- Room types: living room, bedroom, studio
- Categories: bed, sofa, armchair, coffee table, dining table + chairs, desk + desk chair, shelving, wardrobe/dresser, rugs, floor lamps
- Every valid IKEA.ca product variant in these categories: about 2,700, not a hand-picked 300–500
- Generation inputs: room type, budget, style preset (2–3), must-haves
- Real 3D rendering for both the room and the products
- Wall color, floor material, and lighting controls
- Click an item to open its link, delete it, or swap it
- Internal pairwise rating page and layout logging
- Sign in to save rooms and layouts and reopen them later (M6)

**Out of scope**
- Multi-room apartments
- L-shaped, T-shaped and corner furniture: corner and chaise sofas, L-shaped desks, KALLAX desk combinations, corner wardrobes and bookcases (future goal, §8)
- Sharing rooms with other people
- Live price sync (weekly scrape only)
- Mobile layout
- Kitchens, bathrooms, wall-mounted items
- Public launch

## 4. Architecture

```
apps/web (React + R3F) ──► apps/api (Node/Hono) ──► Claude API (vision + layout intent)
     │                          │
     └── packages/geometry ◄────┘   (collision, scorer, solver, shared)
                                │
                          Postgres + R2 storage
                                ▲
     tools/scraper, tools/models (offline: catalog + 3D models)
     ml/ (Python: ratings → reward model → scorer weights)
```

**Core principle:** the LLM decides *what* goes in the room and *roughly where* (relational intent). Deterministic code decides *exact positions* and guarantees validity. The LLM never outputs final coordinates.

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
| Storage | Cloudflare R2 (GLBs, plan images, screenshots) |
| Scraper | Python (httpx, uv), weekly GitHub Actions cron |
| 3D pipeline | gltf-transform (normalize, decimate, meshopt) |
| ML | Python, pandas, scikit-learn / LightGBM, Jupyter |
| Testing | Vitest (golden floor-plan tests) |
| Deploy | Web on Vercel or Cloudflare Pages; API on Railway or Fly.io |

## 5. Data model (sketch)

All lengths in **meters**. See `CLAUDE.md` for the coordinate conventions.

```ts
Room      { id, name, roomType, walls: Wall[], openings: Opening[], materials, sourceImageUrl }
Wall      { id, a: Vec2, b: Vec2, thickness, height }
Opening   { id, wallId, kind: 'door' | 'window', offset, width, height, sillHeight?, swing? }
Product   { articleNo, name, category, priceCad, url, imageUrl, dims: { w, d, h }, shape: 'rect' | 'round', extendedW, modelUrl, modelSource: 'ikea' | 'procedural', styleTags, scrapedAt }
Layout    { id, roomId, inputs, placements: Placement[], score, scoreBreakdown, llmIntent, screenshotUrls, createdAt }
Placement { articleNo, x, y, rotation }
Rating    { id, layoutA, layoutB, winner, note, createdAt }
```

## 6. Milestones

Each milestone ends with something demoable. Estimates assume about 10 hours a week, for a total of about **11–13 weeks**. M1 and M2 are independent and can be interleaved.

### M0 — Foundations (1 week)
- [x] pnpm monorepo: `apps/web`, `apps/api`, `packages/schema`, `packages/geometry`, `tools/`, `ml/`
- [x] zod schemas for every entity above; Drizzle tables generated from them
- [ ] Collect 10–15 test floor plans into `fixtures/plans/` (folder and format ready)
- [x] **Spike:** scrape one category (sofas) end to end: dimensions, price, link, GLB

**Done when:** one sofa renders in a blank R3F scene at its correct real-world size.

### M1 — Catalog (2 weeks)
The catalog keeps **every valid product** in the MVP categories instead of a hand-picked 300–500; generation filters it for each request (M4). The full crawl found 3,062 candidates; after the category rules, **2,711 products** remain, 1,642 of them with an IKEA model. L-shaped, T-shaped and corner pieces stay out until the geometry supports them (§8).

- [x] Scraper for every category: IKEA.ca sitemap, each page's JSON-LD and embedded JSON (`tools/scraper`)
- [x] Rate limiting, caching, `scrapedAt` timestamps
- [x] Full crawl: 25,530 products, 0 failures
- [x] Category rules: IKEA category IDs for each MVP category; skip parts, add-ons, and L-shaped pieces
- [x] Dimension normalizer per category: diameter for round tables, rugs, and lamps; bed length as depth; the everyday size of extendable tables, with the extended length stored
- [x] Product fields: footprint shape, extended width, image URL
- [ ] Product → variant modeling: group colors and sizes into families, from each page's style picker
- [ ] GLB capture for the MVP categories (about 2,000 models)
- [ ] Model pipeline: rescale to listed dims, origin at bottom center, front facing +Z (checked per category), height from the model when the listing has none, decimate, compress, textures ≤ 1024 px, < 1 MB per model, upload to R2
- [ ] Procedural fallback model per category, at the listed size
- [ ] Products in Postgres; the API reads them from the database
- [ ] Catalog viewer (category tabs, product list, 3D preview, IKEA model or stand-in badge) and `pnpm catalog:check`
- [ ] Optional: weekly GitHub Actions refresh of the MVP categories only (the full crawl takes about 7 hours, over the 6-hour job limit)

**Done when:** every valid product in the MVP categories has valid dimensions, price, and link, renders as its IKEA model or a stand-in, and `pnpm catalog:check` passes.

### M2 — Room (2 weeks)
- [ ] Floor plan upload
- [ ] Vision-model extraction to Room JSON (walls, openings, dimension labels → scale)
- [ ] 2D correction editor (drag wall endpoints, add/move/resize openings, set door swing)
- [ ] 3D render: extruded walls, window and door cutouts, floor, ceiling toggle
- [ ] Wall color, floor material (3–5 textures), light warmth and intensity
- [ ] Environment lighting, soft shadows, ambient occlusion

**Done when:** every test plan becomes a correct 3D room in ≤ 2 min of correction.

### M3 — Manual furnishing (1–2 weeks)
- [ ] Catalog browser (filter by category, price, size)
- [ ] Place, drag, and rotate with wall snapping
- [ ] Live validation: overlaps, clearance zones, door swing arcs, highlighted in red
- [ ] Price total and product links

**Done when:** you can furnish a test room by hand and the validator catches every bad placement.

### M4 — Auto layout (2–3 weeks)
- [ ] **Scorer:** hard constraints (pass/fail) plus soft scores (focal point facing, wall alignment, circulation path from door to each zone, bed access, desk near window, symmetry, budget use)
- [ ] **Solver:** turns relational intent into coordinates (greedy placement plus local random search)
- [ ] **LLM intent:** room summary, inputs, and the filtered catalog in; product list plus relational constraints out (zod-validated)
- [ ] **Repair loop:** solver failures go back to the LLM, which picks smaller substitutes
- [ ] **Best-of-N:** generate N candidates, return the top score
- [ ] Log every candidate (not just the winner)

**Done when:** 100% of outputs are valid on the test set and ≥ 60% pass your quality bar.

### M5 — Editing (1 week)
- [ ] Swap drawer: same category, footprint within tolerance, budget filter
- [ ] Delete
- [ ] Re-validate and re-score after every edit
- [ ] Undo/redo

### M6 — Accounts (1 week)
- [ ] Sign in with Supabase Auth (Google or an email link), asked for only when saving; everything else works signed out
- [ ] The API verifies the Supabase session token on account routes
- [ ] `ownerId` on rooms and layouts; users only ever see their own rooms
- [ ] Save a room with its current layout, rename it, delete it (a status flag, never a hard delete)
- [ ] "My rooms" page that reopens a saved room exactly as it was left
- The browser still talks only to our API, so the tables stay closed to Supabase's public Data API (RLS on, no policies).

**Done when:** you can save a furnished room, sign in on another device, and reopen it unchanged.

### M7 — Feedback loop (1 week)
- [ ] Capture canvas screenshots (3 angles) after generation, upload to R2
- [ ] Internal `/admin/rate` page: two layouts side by side, pick the winner, optional note
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
| IKEA.ca structure changes and breaks the scraper | Prefer JSON endpoints; snapshot tests on saved responses; alert on scrape failures |
| IKEA terms of service and model licensing | Personal and portfolio use only; revisit before any public launch |
| Scope creep into multi-room apartments | Not until single rooms pass the quality bar consistently |

## 10. First week

1. Set up the monorepo and CI (lint, typecheck, Vitest).
2. Write the zod schemas.
3. Collect the test floor plans.
4. Sofa spike: scrape, normalize, and render one sofa at true scale.
