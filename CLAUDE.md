# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**Roomie** is a web app that turns a 2D apartment floor plan into a 3D room and furnishes it automatically with real IKEA Canada products. Users can edit the result (swap, delete, move items) and follow product links. Generated layouts are logged and rated internally to improve layout quality over time.

See `PLAN.md` for scope, milestones, and success criteria. Current scope is the MVP: **single rooms or studios only**.

## Architecture principle (read this first)

**The LLM decides *what* and *roughly where*. Code decides *exactly where* and guarantees validity.**

- The LLM returns a product list plus relational intent (e.g. "sofa against longest windowless wall, facing TV unit").
- `packages/geometry` turns intent into coordinates and enforces every hard constraint.
- **Never** take furniture coordinates directly from LLM output. Never ship a layout that hasn't passed `validateLayout()`.

## Repository layout

```
apps/web            React + Vite + React Three Fiber frontend
apps/api            Node + Hono API (generation, catalog, rooms, ratings)
packages/schema     zod schemas: the single source of truth for all types
packages/geometry   collision, clearance, scorer, solver (pure TS, runs in browser and server)
tools/scraper       IKEA.ca scraper (Python, uv): product data in meters, GLBs
tools/models        GLB normalization pipeline (gltf-transform) + procedural fallbacks
ml/                 Python notebooks and scripts for the rating and reward model
fixtures/plans      test floor plans (golden test set)
```

## Commands

```bash
pnpm install
pnpm dev                 # web + api
pnpm test                # vitest across packages
pnpm typecheck
pnpm lint
pnpm db:generate         # drizzle migrations from schema
pnpm db:migrate
pnpm scrape --category fu003     # scrape one IKEA category (fu003 = sofas); no flag = everything
pnpm catalog:import      # scraped items -> data/catalog/products.json (the database from M1)
pnpm models:process      # fit downloaded GLBs to listed dims -> data/models (R2 upload from M1)
```

Python: `tools/scraper` runs on uv (`uv run pytest`, `uv run ruff check`). In `ml/`, `uv sync`, then `uv run jupyter lab`.

## Conventions

### Units and coordinates (most common source of bugs)
- **All lengths are meters** internally. Convert cm and inches at the boundary (scraper, UI input) and nowhere else.
- **2D plan space:** `(x, y)`, x to the right, y down the page as drawn in the source image after scaling.
- **3D space:** Y-up. Plan `(x, y)` maps to 3D `(x, 0, y)`.
- **Rotation:** radians about the vertical axis. `0` means the product's front faces plan **+y** (3D +Z).
- **Product models:** origin at the **bottom center** of the bounding box, front facing **+Z**, scaled to listed dimensions. The model pipeline enforces this; never compensate in render code.
- **Product dims:** `w` = width (local X), `d` = depth (local Z), `h` = height (local Y).

### Types and validation
- Define types in `packages/schema` with zod and infer TS types from them. Don't hand-write duplicate interfaces.
- Validate all LLM output, API input, and scraped data with zod before use.
- Room geometry and placements are stored as JSONB, so validate on read as well as on write.

### Geometry package
- Pure functions only: no React, no I/O, no randomness without an injected seed.
- Every new constraint or scoring rule needs a Vitest test, and should be checked against `fixtures/plans`.
- Hard constraints return pass/fail with a reason. Soft scores return a number in `[0, 1]` plus a breakdown for logging.
- Scorer weights are loaded from `packages/geometry/weights.json` (produced by `ml/`). Don't hardcode weights in logic.

### LLM calls
- Prompts live in `apps/api/src/prompts/` as versioned files. Log the prompt version with every generated layout.
- Use structured output with zod schemas. On a parse failure, retry once with the error, then fail cleanly.
- Model names come from config, not inline strings.

### Frontend
- 3D scene components live in `apps/web/src/scene/`, UI panels in `apps/web/src/ui/`.
- App state is in Zustand stores. Room and layout edits go through store actions so undo works.
- Validation runs live while dragging, using `packages/geometry` directly in the browser.
- Watch performance: instance repeated models, dispose GLTFs on unmount, and keep draw calls low.

### Scraper
- Prefer IKEA.ca's JSON endpoints and embedded JSON-LD over HTML parsing.
- Rate-limit (≥ 1 s between requests), cache raw responses to disk, and stamp `scrapedAt` on every record.
- Store raw responses so the normalizer can be rerun without re-scraping.
- Only fetch URLs on the allowlist in `tools/scraper/src/ikea_scraper/http.py`. Each entry was checked against robots.txt; re-check before adding one (www.ikea.com disallows `*/global/assets/rotera/*`).
- No credentials: no API keys, client IDs, logins or cookies, even ones embedded in IKEA's pages.
- Scraped data and models live in `data/`, which is gitignored. The repo is public: never commit them, or real IKEA pages as test fixtures.
- Data is for personal and portfolio use. Don't add features that redistribute the catalog or IKEA's 3D models publicly.

### Logging and data for ML
- Log **every** generated candidate, not just the winner: inputs, LLM intent, placements, score breakdown, prompt version.
- Never delete layouts or ratings. Add a status flag instead.

## Things to avoid
- Putting coordinates from the LLM straight into a layout.
- Mixing units, or converting inside geometry or render code.
- Fixing model scale or orientation in the renderer instead of in `tools/models`.
- Adding multi-room support, accounts, or other out-of-scope features from `PLAN.md` without asking.
- Large dependencies when a small function will do (e.g. rectangle collision via the separating axis theorem is ~50 lines).

## Workflow
- Keep changes small and scoped to one milestone task at a time.
- Run `pnpm typecheck && pnpm test` before considering a task done.
- When changing a schema, update the Drizzle migration and any affected fixtures in the same change.
- When unsure about a product or layout rule, ask rather than guess.

## Git
- **Never** add Claude as a co-author or add any AI attribution (`Co-Authored-By: Claude ...`, "Generated with Claude Code", etc.) to commit messages, PR descriptions, or anything pushed. No exceptions.
- Commit messages are a single short line in Conventional Commits format: `type(scope): summary`
  - `type`: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`
  - `scope` is optional: a package or app name, e.g. `schema`, `geometry`, `web`, `api`, `scraper`
  - `summary`: lowercase, imperative, no trailing period, ≤ 60 chars
  - Examples: `chore: initial setup`, `feat(schema): add room and wall schemas`, `fix(geometry): handle rotated overlap`
