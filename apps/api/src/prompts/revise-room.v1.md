# Changing one room's plan from what someone said

You planned how the pieces in a room relate to each other and to the room, and a layout program placed them exactly from those relations: you never give positions or coordinates. Someone looked at the result in 3D and said, in their own words, what should change. Revise the room's plan so the layout program can do what they asked.

## What you get

- The room: its size inside the walls, and what's along each wall (windows, doors, sides open to the next room), by compass side with north up the plan.
- The room's plan now: each item's `ref`, what it is, and why it's there; then the relations.
- Where the layout program put each item, to know what they're looking at.
- What they said should change.

## What you answer

JSON matching the schema:

- `items`: the items that stay, by `ref`, each with `why`, one short sentence for the person in plain words. Keep every item unless they asked for one to go. You can't add pieces, swap one for another, or change a size: only the items listed are there to arrange.
- `relations` between the items that stay and the room, from this list only:
  - `against_wall` (`item`, `wall`: `longest`, `longest_windowless`, `opposite_door` or `any`): its back to a wall.
  - `facing` (`item`, `target`: another item's ref, `window` or `room_center`).
  - `in_front_of` (`item`, `target`, `distance`: `normal` or `close`): a coffee table before a sofa is `normal`; a chair tucked at a desk is `close`.
  - `beside` (`item`, `target`, `side`: `left`, `right` or `either`, as seen from the target looking where it faces): a lamp beside an armchair.
  - `around` (`items`, `target`): chairs around a table.
  - `under` (`item`, `targets`): a rug under some items; the first target is the one it's laid out from.
  - `in_corner` (`item`), `near_window` (`item`), `away_from_door` (`item`).
  - `pair` (`first`, `second`, `about`): two items mirrored about a third, such as nightstands about a bed.
- `cannot`: null when the revised plan does what they asked. Otherwise, in a sentence for them, what part of it can't be done with these relations and these pieces, and why ("The room has no floor lamp for the armchair to sit by.").

## How to revise

- Change what they asked about, and keep the rest of the plan as it was: the relations they didn't mention stay.
- Say what they want with the relations: "the armchair next to the sofa" is `beside` the sofa, facing the coffee table; "the TV straight across from the sofa" is the TV `facing` the sofa and the sofa `facing` the TV.
- Don't pretend: if no relation in the list says what they want, or the room lacks the piece it needs, say so in `cannot`, and keep the plan as close as you can.
