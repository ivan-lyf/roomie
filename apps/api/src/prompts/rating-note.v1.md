# Reading what someone said about two layouts

Someone compared two layouts of the same room, A and B, picked the better one, and said in their own words what's wrong. Read what they wrote into labels, one for each problem they name, so the layouts can be made better from it.

Each label has:

- **side**: the layout it's about: `a`, `b`, or `both` when the note says it of both, or of the room whichever layout it is.
- **items**: the ids of the items it's about (`f3`), from the lists of what each layout holds. Empty when it's about the room as a whole.
- **problem**, one of:
  - `too_far_from`, `too_close_to`: an item is too far from, or too close to, another one, given as `relativeTo`.
  - `facing_away`: an item faces the wrong way, or away from what it should face.
  - `blocks`: an item is in the way of a path, a door, or another item (that one as `relativeTo`).
  - `against_window`: an item stands in front of a window.
  - `off_center`: an item isn't centered where it should be: a TV across from a sofa, a bed on its wall, a rug under a group.
  - `wrong_size`: an item is too big or too small for the room, or for where it stands.
  - `missing`: the room needs something it doesn't have. Items are empty; the rule says what.
  - `not_needed`: an item shouldn't be in the room.
  - `style`: pieces don't go together: their colours, materials or look clash.
  - `other`: anything else.
- **relativeTo**: the id of the other item for `too_far_from`, `too_close_to` and `blocks`; otherwise null.
- **feature**: the measure of the layout program the problem bears on, or null when none of them measures it:
  - `relations`: pieces where the plan put them relative to each other (a coffee table in front of the sofa, nightstands beside the bed).
  - `walls`: pieces that belong against a wall have their backs to one.
  - `focal`: seats face the TV, or the coffee table when there's no TV.
  - `tv_view`: the TV is straight across from the sofa, centered on it, and at a good distance.
  - `armchairs`: an armchair sits with the sofa group, or makes a corner of its own by a lamp or a window.
  - `walkway`: there's room to walk through the room and to every door.
  - `bed_head`: the bed's head is against a wall.
  - `desk_window`: the desk is by a window.
  - `windows`: windows are left clear.
  - `spread`: the pieces are spread through the room, not crowded into one part.
- **rule**: the general rule the note implies, as a short plain sentence that would hold in any home ("An armchair belongs within reach of the sofa, or by a lamp."), or null when it implies none.

Label only what the notes say: don't add problems of your own, and don't judge the layouts yourself. A note that names no problem ("both are fine") gets no labels. Which layout they picked, and the room problems they ticked, help you read the notes, but they aren't notes themselves.
