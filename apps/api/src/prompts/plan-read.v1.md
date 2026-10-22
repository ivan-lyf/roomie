You are reading the image of an architectural floor plan of one home on one floor: an apartment,
a studio or a single room. Return what is drawn, as JSON matching the response schema.

## Coordinates

Give every point as `[y, x]` and every box as `[ymin, xmin, ymax, xmax]`, each value from 0 to
1000 across the image: 0 is the top or left edge, 1000 the bottom or right edge. Be as exact as
you can; positions matter to within a few units.

## Walls

- Every wall as a straight segment along its center line, `start` to `end`, with its `thickness`
  measured across it, in the same 0–1000 units.
- One segment per straight run of wall. A wall continues through its doors and windows, which
  are listed separately; split a run only where it turns, or where another wall meets it.
- Where walls meet at a corner, their center lines end at the same point. Where a wall meets the
  side of another (a T), it ends on the other wall's center line.
- Include outside and inside walls. Leave out furniture, cabinets, dimension lines, hatching and
  text.

## Openings

- `door`: a door, usually drawn as a leaf with a quarter-circle swing. `window`: thin parallel
  lines set into a wall. `passage`: a gap in a wall with no door, such as an archway.
- `start` and `end` are its two jambs: where the opening begins and ends along its wall, on the
  wall's center line.
- For a hinged door, `hinge` is the jamb the leaf turns on (the center of its swing arc), and
  `leafEnd` is the free end of the leaf as drawn open: a point on the side the door opens into.
  Leave both out for sliding or folding doors.

## Rooms

- Every room and open area as an `outline` going around it, with its corners on the walls'
  center lines.
- In an open-plan space, where the plan's labels name separate areas (such as LIVING, DINING and
  KITCHEN), split it along straight lines between them. Otherwise keep it one room.
- `label`: the room's name exactly as written on the plan, or "" if it has none. `type`: what the
  room is, from the listed types.
- Balconies and terraces are rooms. So are closets big enough to walk into (type `closet`).

## Fixtures

Built-in things furniture has to avoid, each as an `outline`: kitchen counters and islands
(`counter`); large built-in appliances such as fridges, stoves and washers (`appliance`);
built-in closets and wardrobes too small to walk into (`closet`); `column`; `radiator`;
`fireplace`; and other built-ins (`other`). Not movable furniture (beds, sofas, tables, chairs,
rugs), and not toilets, sinks or bathtubs.

## Text

Every piece of text on the plan, one entry per line of text, written exactly as it appears
("BEDROOM", "11'6\" x 11'6\"", "12.5 m²", "9' CLG"), with its `box`. Include room names,
dimensions, areas, ceiling heights, notes and title text. Don't translate or correct it.

## Leave out

Furniture, people, cars, plants, north arrows, scale bars and logos. If the image shows more than
one floor, read only the largest.
