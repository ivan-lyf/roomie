# Roomie

**Upload a floor plan, get a furnished 3D home with real IKEA Canada products that actually fits.**

Roomie takes the floor plan of a room, a studio, or a whole apartment and turns it into 3D. It then fills the rooms with real furniture from IKEA.ca. You can walk around the result, swap or delete pieces, and click any item to open it on IKEA's site. Every product has a real price, so you can see what each room, and the whole home, would cost.

> **Status:** M0 (foundations) is done: the monorepo, data schemas, the IKEA.ca scraper, and a single real sofa shown in 3D at its true size. M1, the full catalog, is under way: all of IKEA.ca has been crawled and the database is set up. See [PLAN.md](PLAN.md) for the roadmap.

## How it works

1. **Upload a floor plan.** An AI vision model reads the walls, doors, windows and rooms, and uses the plan's text ("Bedroom", "LR", "12' x 10'") to tell what each room is for and how big it is, detecting feet or metric on its own. If the plan has no measurements, measure one wall, or enter the known area (optionally with one measured side), and Roomie works out the rest. You fix anything it got wrong in a simple 2D editor.
2. **Pick a few preferences.** Choose which rooms to furnish, a budget for the whole home, a style, and anything you must have.
3. **Get furnished rooms.** Claude picks the products and says roughly where they should go ("sofa against the longest wall, facing the TV"). Then regular code works out the exact positions and checks that the layout works in real life:
   - no furniture overlaps
   - no blocked doors
   - walkways at least 75 cm wide
4. **Edit it.** Swap an item for a similar one, delete it, or drag it around. The layout is checked again live as you edit.
5. **Save it.** Sign in to keep your homes and reopen them later, on any device.

Every generated layout is logged and rated internally, so layouts get better over time.

## What's in scope (MVP)

- Single-floor homes: single rooms, studios and multi-room apartments
- Living rooms, bedrooms, studios, dining areas and dens get furnished; kitchens, bathrooms, hallways and the like are shown in 3D but left empty
- Beds, nightstands, sofas, armchairs, coffee tables, TV units, dining sets, desks, shelving, wardrobes, dressers, rugs and floor lamps
- About 2,900 IKEA.ca products: every valid one in these categories
- Wall color, floor material and lighting controls
- Sign in to save your homes

Multi-storey homes, furnishing kitchens and bathrooms, wall-mounted items, L-shaped and corner furniture, sharing and mobile layouts are out of scope for now. L-shaped furniture is a possible later addition (see [PLAN.md](PLAN.md)).

## Tech stack

| Part | Tools |
|---|---|
| Web app | React, Vite, TypeScript, React Three Fiber (3D), Tailwind |
| API | Node, Hono, Claude API, Drizzle ORM |
| Database, sign-in and storage | Postgres and Auth on Supabase, Cloudflare R2 |
| Product catalog | Python scraper for IKEA.ca (public pages, no credentials) |
| Layout learning | Python, pandas, scikit-learn / LightGBM |

## Getting started

You'll need:

- Node 24+ and pnpm
- Python with [uv](https://docs.astral.sh/uv/) (for the scraper and the `ml/` folder)
- A Postgres database (we use Supabase); later a Claude API key and a Cloudflare R2 bucket

Copy `.env.example` to `.env` and fill in your own values. `.env` is gitignored and must never be committed. The API reads the catalog from Postgres, so set `DATABASE_URL` and run `pnpm db:migrate` once.

To see a real IKEA sofa in 3D:

```bash
pnpm install
pnpm scrape --category fu003 --models   # fetch IKEA.ca's sofas and their 3D models (~20 min)
pnpm catalog:import                     # turn them into catalog products
pnpm models:process                     # fit each model to its listed size, or make a stand-in
pnpm catalog:publish                    # write the products to the database
pnpm dev                                # then open http://localhost:5173
```

For the whole catalog (about 2,900 products), run `pnpm scrape` (every IKEA.ca product, about 7 hours), `pnpm catalog:import`, `pnpm models:download` (about 40 minutes), `pnpm models:process` and `pnpm catalog:publish`. `pnpm catalog:check` then confirms every product has sound data and a true-to-size model.

Scraped data and models stay in `data/`, which is gitignored.

## Repository layout

| Folder | What's in it |
|---|---|
| `apps/web` | The React + React Three Fiber frontend |
| `apps/api` | The Hono API and the database tables |
| `packages/schema` | Zod schemas: the one definition of every data type |
| `packages/geometry` | Pure geometry code, shared by the browser and the server |
| `tools/scraper` | The Python IKEA.ca scraper ([README](tools/scraper/README.md)) |
| `tools/models` | Fits downloaded 3D models to their listed sizes |
| `ml/` | Python notebooks for learning from layout ratings |
| `fixtures/plans` | The test floor plans ([README](fixtures/plans/README.md)) |

## Project docs

- [PLAN.md](PLAN.md): goals, scope, milestones and risks
- [CLAUDE.md](CLAUDE.md): coding conventions (units, coordinates, git rules)

## Note

This is a personal and portfolio project. Product data and 3D models belong to IKEA and are not redistributed.
