# Test floor plans

The golden test set: 10–15 real floor plans of single rooms or studios (see PLAN.md, section 2).
Vision extraction, constraints and scoring rules are all checked against these.

## Layout

One folder per plan, named `<NN>-<short-name>`:

```
fixtures/plans/
  01-kits-studio/
    plan.png      the source image (or .jpg / .pdf)
    meta.json     where it came from and what it is
    room.json     the corrected Room, added once the M2 editor exists
```

`meta.json`:

```json
{
  "source": "https://example.com/listing/123",
  "collectedAt": "2026-10-21",
  "roomType": "studio",
  "listedAreaSqft": 450,
  "notes": "Dimension labels in feet. One window wall."
}
```

`roomType` is one of `living_room`, `bedroom` or `studio`. `room.json` is a `Room` from
`packages/schema`, in meters and checked by hand. It's both the expected output of vision
extraction and the input to the layout tests.

## What to collect

Aim for a mix:

- studios, bedrooms and living rooms
- plans with and without dimension labels
- plain rectangles and awkward shapes (L-shapes, angled walls, bay windows)
- doors in awkward spots, several windows, columns or radiators
- different drawing styles (agency plans, hand drawings, 3D-style renders)

## Image rights

This repo is public, so only commit images you're allowed to share. For listing images that
belong to someone else, put the image in `data/plans/<folder>/` (gitignored) and commit only
`meta.json` and `room.json`.
