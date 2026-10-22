# Test floor plans

The golden test set: 10–15 real floor plans of single-floor homes, at least half of them
multi-room (see PLAN.md, section 2). Vision extraction, unit detection, scale, constraints and
scoring rules are all checked against these.

## Layout

One folder per plan, named `<NN>-<short-name>`:

```
fixtures/plans/
  01-kits-studio/
    plan.png         the source image (or .jpg / .pdf)
    meta.json        where it came from and what it is
    floorplan.json   the corrected Floorplan, added once the M2 editor exists
```

`meta.json`:

```json
{
  "source": "https://example.com/listing/123",
  "collectedAt": "2026-10-21",
  "kind": "multi_room",
  "rooms": ["living_room", "bedroom", "kitchen", "bathroom"],
  "units": "imperial",
  "listedAreaSqft": 650,
  "listedAreaIncludes": "unknown",
  "calibration": null,
  "notes": "Dimension labels in feet. Sample furniture drawn in. Open kitchen."
}
```

- `kind` is `single_room`, `studio` or `multi_room`.
- `rooms` lists the expected room types, in any order (see PLAN.md, section 3).
- `units` is the unit the labels use: `imperial`, `metric_m`, `metric_cm`, `metric_mm`, or
  `none` when the plan has no dimension labels. It's the expected result of unit detection.
- `listedAreaIncludes` is what the listing's area covers, if known: `interior`, `with_walls`,
  `with_balcony` or `unknown`.
- `calibration` is required when `units` is `none`: a measurement to calibrate with, e.g.
  `{ "wallLengthM": 3.66, "note": "north wall of the bedroom" }`, or `{ "areaSqft": 450 }`.

`floorplan.json` is a `Floorplan` from `packages/schema`, in meters and checked by hand.
It's both the expected output of vision extraction and the input to the layout tests.

## What to collect

Aim for a mix:

- studios, 1-bedroom and 2-bedroom apartments, plus a single bedroom or living room
- open-plan homes where a living room runs into a dining area or kitchen
- labels in imperial, metric meters, and metric millimetres, and some plans with no labels at all
- room labels as words and as abbreviations (`BR`, `LR`, `W/D`, `WIC`, `DEN`)
- plans with sample furniture drawn in, and with fixed elements (counters, closets, columns, radiators)
- plain rectangles and awkward shapes (L-shapes, angled walls, bay windows)
- doors in awkward spots, several windows
- different drawing styles (agency plans, hand drawings, 3D-style renders)

## Image rights

This repo is public, so only commit images you're allowed to share. For listing images that
belong to someone else, put the image in `data/plans/<folder>/` (gitignored) and commit only
`meta.json` and `floorplan.json`.
