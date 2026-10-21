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
- About 300–500 product variants from IKEA.ca
- Generation inputs: room type, budget, style preset (2–3), must-haves
- Real 3D rendering for both the room and the products
- Wall color, floor material, and lighting controls
- Click an item to open its link, delete it, or swap it
- Internal pairwise rating page and layout logging

**Out of scope**
- Multi-room apartments
- User accounts and sharing
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
Product   { articleNo, name, category, priceCad, url, dims: { w, d, h }, modelUrl, modelSource: 'ikea' | 'procedural', styleTags, scrapedAt }
Layout    { id, roomId, inputs, placements: Placement[], score, scoreBreakdown, llmIntent, screenshotUrls, createdAt }
Placement { articleNo, x, y, rotation }
Rating    { id, layoutA, layoutB, winner, note, createdAt }
```

## 6. Milestones

Each milestone ends with something demoable. Estimates assume about 10 hours a week, for a total of about **10–12 weeks**. M1 and M2 are independent and can be interleaved.

### M0 — Foundations (1 week)
- [ ] pnpm monorepo: `apps/web`, `apps/api`, `packages/schema`, `packages/geometry`, `tools/`, `ml/`
- [ ] zod schemas for every entity above; Drizzle tables generated from them
- [ ] Collect 10–15 test floor plans into `fixtures/plans/`
- [ ] **Spike:** scrape one category (sofas) end to end: dimensions, price, link, GLB

**Done when:** one sofa renders in a blank R3F scene at its correct real-world size.

### M1 — Catalog (2 weeks)
- [ ] Scraper for all MVP categories (prefer IKEA.ca's JSON endpoints and JSON-LD over HTML)
- [ ] Dimension normalizer (cm and inches, extendable min/max, category-specific fields)
- [ ] Product → variant modeling (article number per color and size)
- [ ] GLB capture where available
- [ ] Model pipeline: rescale to listed dims, origin at bottom center, front facing +Z, decimate, compress, upload to R2
- [ ] Procedural fallback model per category
- [ ] Rate limiting, caching, `scrapedAt` timestamps

**Done when:** 300+ variants have valid dimensions, price, and link, and every one renders.

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

### M6 — Feedback loop (1 week)
- [ ] Capture canvas screenshots (3 angles) after generation, upload to R2
- [ ] Internal `/admin/rate` page: two layouts side by side, pick the winner, optional note
- [ ] Rate 100+ pairs
- [ ] Few-shot loop: inject top-rated layouts into the intent prompt
- [ ] First `ml/` notebook: Bradley–Terry model on scorer features → `weights.json` loaded by the scorer

## 7. Feedback pipeline roadmap (post-MVP)

1. **Few-shot prompting** with top-rated layouts (M6)
2. **Best-of-N reranking** with the learned weights
3. **Learned reward model** (LightGBM → ONNX → onnxruntime-node) once there are several hundred comparisons
4. **Vision judge:** score screenshots against a rubric, measure agreement with your ratings
5. **Implicit signals:** user keeps, swaps, and deletes as training data
6. **Fine-tuning** only with thousands of high-quality examples

Prior work to read: 3D-FRONT dataset (research license), ATISS, LayoutGPT, Holodeck.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Captured GLBs have inconsistent scale, orientation, or size | Normalize everything in M1; procedural fallback so no product is blocked |
| Layouts are valid but ugly | Scorer and ratings exist for this; iterate on scoring rules more than prompts |
| Vision extraction fails on some plan styles | The correction editor is the safety net; don't chase full automation |
| IKEA.ca structure changes and breaks the scraper | Prefer JSON endpoints; snapshot tests on saved responses; alert on scrape failures |
| IKEA terms of service and model licensing | Personal and portfolio use only; revisit before any public launch |
| Scope creep into multi-room apartments | Not until single rooms pass the quality bar consistently |

## 9. First week

1. Set up the monorepo and CI (lint, typecheck, Vitest).
2. Write the zod schemas.
3. Collect the test floor plans.
4. Sofa spike: scrape, normalize, and render one sofa at true scale.
