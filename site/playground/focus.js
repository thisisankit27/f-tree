/*
 * Who belongs on a chart centred on one person, and which generation they stand in.
 *
 * A transcription of the selection half of `app/.../graph/TreeLayoutEngine.kt` -- the function
 * `collect`, and nothing else from that file. The other 250 lines of it work out coordinates, and
 * coordinates are the one thing this does not need: `compactFamily` consumes ids and levels.
 *
 * It lives in `site/playground/` rather than in the desktop app because it is a *rule about
 * families*, not a drawing decision, and every rule ported out of the Kotlin is a rule that can
 * quietly drift. One copy, one test table.
 *
 * A divergence worth stating plainly, because it is deliberate rather than an oversight:
 *
 *   On Android, the compact view is built from the focused chart's own output, so the two cannot
 *   disagree about who is family. The desktop's chart is the *whole* tree, and the focused chart is
 *   not being ported (see #89) -- so on the desktop, compact makes this selection itself. That is
 *   why the rules are here, in one shared module, instead of inside whichever view happened to
 *   need them first.
 */

/**
 * Chooses who appears on a chart centred on `focusId`, and at what generation offset.
 *
 * Ancestors and descendants of the focus, the focus's own siblings, and the partners of all of
 * them. Deliberately *not* included: the descendants of siblings and of ancestors' siblings.
 * Cousins and nieces multiply a chart's width far faster than they add to what it tells you, and
 * they are one click away by re-focusing.
 *
 * Returns `{ levels, focusId, truncated }`, where `levels` maps a person's id to their offset from
 * the focus: -1 is a parent, +1 a child, 0 the row the focus stands in. `focusId` is null when
 * there is no such person, and `levels` is then empty -- an unknown focus produces nothing rather
 * than throwing, because "the tree you loaded no longer has the person you had selected" is a
 * thing that happens and is not an error.
 */
export function collectFocused(graph, focusId, { up = 3, down = 3 } = {}) {
  if (!graph.people.has(focusId)) return { levels: new Map(), focusId: null, truncated: false };

  const levels = new Map([[focusId, 0]]);
  let truncated = false;

  // `putIfAbsent` throughout, as the Kotlin has it: the first assignment of a level wins. It is
  // what keeps a cousin marriage stable -- somebody reachable as both a cousin and an in-law gets
  // one level and keeps it, rather than flickering between two depending on the walk.
  const place = (id, level) => { if (!levels.has(id)) levels.set(id, level); };
  const addPartners = (id, level) => {
    for (const spouse of graph.spouses(id)) place(spouse.id, level);
  };

  // The focus's siblings share the row.
  const siblingIds = graph.siblings(focusId).map((s) => s.id);
  for (const id of siblingIds) place(id, 0);
  for (const id of [...levels.keys()]) addPartners(id, 0);

  // Upwards, from the focus and their siblings together: a chart centred on somebody shows their
  // parents, and their siblings' parents are the same people.
  let frontier = new Set([...siblingIds, focusId]);
  for (let generation = 1; generation <= up; generation++) {
    const parents = new Set();
    for (const id of frontier) for (const p of graph.parents(id)) parents.add(p.id);
    if (parents.size === 0) break;
    for (const id of parents) place(id, -generation);
    for (const id of parents) addPartners(id, -generation);
    frontier = parents;
    // Only asked at the limit, and only of the ring actually reached. A line that simply ends is
    // not truncated -- the `break` above has already left the loop in that case.
    if (generation === up && [...parents].some((id) => graph.parents(id).length > 0)) {
      truncated = true;
    }
  }

  // Downwards from the focus alone. Not from the siblings: their children are nieces and nephews,
  // and including them is the same width explosion as cousins, arriving from the other direction.
  frontier = new Set([focusId]);
  for (let generation = 1; generation <= down; generation++) {
    const children = new Set();
    for (const id of frontier) for (const c of graph.children(id)) children.add(c.id);
    if (children.size === 0) break;
    for (const id of children) place(id, generation);
    for (const id of children) addPartners(id, generation);
    frontier = children;
    if (generation === down && [...children].some((id) => graph.children(id).length > 0)) {
      truncated = true;
    }
  }

  return { levels, focusId, truncated };
}

/**
 * The person to centre on when nobody has been chosen: whoever has the most relatives recorded.
 *
 * Not in the Kotlin, because the phone always has a person in hand -- you arrive at the focused
 * chart *from* somebody. The desktop can open a file and show a chart with nothing selected, so it
 * needs an answer to "centred on whom?" that is better than "the first row of the file", which is
 * export order and means nothing to a reader.
 *
 * The most-connected person is a good guess for the same reason they are most connected: a tree is
 * usually built outwards from somebody, and the chart is most legible centred near the middle of
 * it. Ties break on id so that opening the same file twice gives the same chart.
 */
export function mostConnected(graph) {
  let best = null;
  let bestScore = -1;
  for (const id of [...graph.order].sort()) {
    const score = graph.parents(id).length + graph.children(id).length
      + graph.spouses(id).length + graph.siblings(id).length;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}
