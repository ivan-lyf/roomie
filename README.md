# Roomie

**Upload a floor plan, get a furnished 3D room with real IKEA Canada products that actually fits.**

Roomie takes the floor plan of a single room or studio and turns it into a 3D room. It then fills the room with real furniture from IKEA.ca. You can walk around the result, swap or delete pieces, and click any item to open it on IKEA's site. Every product has a real price, so you can see what the whole room would cost.

> **Status:** early planning. Nothing is built yet. See [PLAN.md](PLAN.md) for the roadmap.

## How it works

1. **Upload a floor plan.** An AI vision model reads the walls, doors and windows. You fix anything it got wrong in a simple 2D editor.
2. **Pick a few preferences.** Choose a room type (living room, bedroom or studio), a budget, a style, and anything you must have.
3. **Get a furnished room.** Claude picks the products and says roughly where they should go ("sofa against the longest wall, facing the TV"). Then regular code works out the exact positions and checks that the layout works in real life:
   - no furniture overlaps
   - no blocked doors
   - walkways at least 75 cm wide
4. **Edit it.** Swap an item for a similar one, delete it, or drag it around. The layout is checked again live as you edit.

Every generated layout is saved and rated internally, so layouts get better over time.

## What's in scope (MVP)

- Single rooms and studios only (no multi-room apartments yet)
- Beds, sofas, armchairs, coffee tables, dining sets, desks, shelving, wardrobes, dressers, rugs and floor lamps
- About 300–500 IKEA.ca products
- Wall color, floor material and lighting controls

Kitchens, bathrooms, wall-mounted items, user accounts and mobile layouts are out of scope for now.

## Tech stack (planned)

| Part | Tools |
|---|---|
| Web app | React, Vite, TypeScript, React Three Fiber (3D), Tailwind |
| API | Node, Hono, Claude API, Drizzle ORM |
| Database and storage | Postgres on Supabase, Cloudflare R2 |
| Product catalog | Python scraper for IKEA.ca (public pages, no credentials) |
| Layout learning | Python, pandas, scikit-learn / LightGBM |

## Getting started

The code isn't set up yet. When it is, you'll need:

- Node 24+ and pnpm
- Python with [uv](https://docs.astral.sh/uv/) (for the `ml/` folder)
- A Supabase project, a Claude API key and a Cloudflare R2 bucket

Copy `.env.example` to `.env` and fill in your own values. `.env` is gitignored and must never be committed.

## Project docs

- [PLAN.md](PLAN.md): goals, scope, milestones and risks
- [CLAUDE.md](CLAUDE.md): coding conventions (units, coordinates, git rules)

## Note

This is a personal and portfolio project. Product data and 3D models belong to IKEA and are not redistributed.
