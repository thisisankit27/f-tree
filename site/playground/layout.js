/*
 * Laying out an entire archive.
 *
 * The app lays out one person's neighbourhood, which is the right answer on a phone: a whole family
 * drawn at once is something no phone can show and no person can read. This page has a television
 * to fill, so it lays out everybody - including the people no edge reaches, who the app never draws
 * at all.
 *
 * The method is the standard layered one, adapted for genealogy:
 *
 *   1. every person gets a generation, with spouses forced onto the same row
 *   2. each connected component is ordered within its rows to reduce crossings, with couples
 *      locked together so they never drift apart
 *   3. x is assigned by two opposing passes and averaged, which centres parents over their
 *      children without letting rows overlap
 *   4. components are packed onto shelves that share one generation grid, so a hundred small
 *      families read as one stratified diagram rather than a hundred scattered blocks
 *
 * Positions are in layout units. The renderer scales them; nothing here knows about pixels.
 */

export const METRICS = {
  NODE_W: 188,
  NODE_H: 64,
  /** Between partners, kept tight so a couple reads as one block. */
  COUPLE_GAP: 14,
  /** Between unrelated blocks on a row. The difference from COUPLE_GAP is what marks a couple. */
  SIBLING_GAP: 38,
  /** Between generations, leaving room for the descent connectors. */
  LEVEL_GAP: 88,
  /** Around a component's contents, inside its frame. */
  GROUP_PAD: 34,
  GROUP_GAP: 64,
  /** Left margin inside a shelf, reserved for the generation labels. */
  GUTTER: 76,
  MARGIN: 60,
};

const ROW_PITCH = METRICS.NODE_H + METRICS.LEVEL_GAP;

/* ------------------------------------------------------------------ generations */

/**
 * Puts every person on a generation.
 *
 * Spouses are unioned first so a married pair cannot land a row apart, then generations are the
 * longest path over parent edges between those unions. Longest rather than shortest: a person with
 * both a parent and a great-grandparent recorded belongs below the deeper of the two, or the
 * connector would run upward.
 */
function assignLevels(graph) {
  const parentOf = new Map();
  const find = (x) => {
    let root = x;
    while (parentOf.get(root) !== root) root = parentOf.get(root);
    while (parentOf.get(x) !== root) { const next = parentOf.get(x); parentOf.set(x, root); x = next; }
    return root;
  };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parentOf.set(ra, rb); };

  for (const id of graph.order) parentOf.set(id, id);
  for (const id of graph.order) for (const s of graph.spouses(id)) union(id, s.id);

  // One vertex per spouse-union; parent edges become edges between unions.
  const groupEdges = new Map();
  const indegree = new Map();
  for (const id of graph.order) { groupEdges.set(find(id), groupEdges.get(find(id)) ?? new Set()); indegree.set(find(id), 0); }
  for (const id of graph.order) {
    for (const c of graph.children(id)) {
      const a = find(id);
      const b = find(c.id);
      if (a === b) continue;               // a couple who are also parent and child: ignore, unplaceable
      const outs = groupEdges.get(a);
      if (!outs.has(b)) { outs.add(b); indegree.set(b, indegree.get(b) + 1); }
    }
  }

  const level = new Map();
  for (const g of groupEdges.keys()) level.set(g, 0);

  // Kahn's order gives the longest path exactly in one pass.
  const queue = [...indegree.keys()].filter((g) => indegree.get(g) === 0);
  let head = 0;
  let placed = 0;
  while (head < queue.length) {
    const g = queue[head++];
    placed++;
    for (const next of groupEdges.get(g)) {
      level.set(next, Math.max(level.get(next), level.get(g) + 1));
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  // Anything left sits in a cycle, which the app's rules forbid but a hand-edited file could hold.
  // Relax it a bounded number of times so a broken file still draws instead of hanging.
  if (placed < groupEdges.size) {
    for (let pass = 0; pass < 40; pass++) {
      let changed = false;
      for (const [g, outs] of groupEdges) {
        for (const next of outs) {
          if (level.get(next) <= level.get(g)) { level.set(next, level.get(g) + 1); changed = true; }
        }
      }
      if (!changed) break;
    }
  }

  /*
   * Longest-path ranking leaves slack: a person whose only child married into a much deeper part
   * of the family gets stranded at the top of the chart with a connector three rows long. Pull
   * every group down until it sits directly above its earliest child, which is as far as it can go
   * without overtaking its own parents.
   */
  const groupParents = new Map();
  for (const [g, outs] of groupEdges) {
    for (const next of outs) {
      if (!groupParents.has(next)) groupParents.set(next, new Set());
      groupParents.get(next).add(g);
    }
  }
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const [g, outs] of groupEdges) {
      if (outs.size === 0) continue;
      let earliestChild = Infinity;
      for (const next of outs) earliestChild = Math.min(earliestChild, level.get(next));
      let floor = 0;
      for (const p of groupParents.get(g) ?? []) floor = Math.max(floor, level.get(p) + 1);
      const want = earliestChild - 1;
      if (want > level.get(g) && want >= floor) { level.set(g, want); changed = true; }
    }
    if (!changed) break;
  }

  const levels = new Map();
  for (const id of graph.order) levels.set(id, level.get(find(id)) ?? 0);
  return levels;
}

/* ------------------------------------------------------------------ ordering within rows */

const byBirth = (graph) => (a, b) => {
  const pa = graph.people.get(a);
  const pb = graph.people.get(b);
  const ya = /^(\d{4})/.exec(pa.birthDate ?? '')?.[1];
  const yb = /^(\d{4})/.exec(pb.birthDate ?? '')?.[1];
  if (ya && yb && ya !== yb) return Number(ya) - Number(yb);
  if (ya && !yb) return -1;
  if (!ya && yb) return 1;
  return (pa.name ?? '￿').localeCompare(pb.name ?? '￿');
};

/**
 * A first ordering, walked family by family.
 *
 * Depth-first from the shallowest member, placing spouses immediately beside each other and then
 * descending through each family's children in birth order. This alone lays out a tree-shaped
 * family correctly; the sweeps that follow only have to fix the places where it is not a tree.
 */
function initialOrder(graph, members, levels) {
  const rows = new Map();
  const seen = new Set();
  const compare = byBirth(graph);

  const place = (id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const l = levels.get(id);
    if (!rows.has(l)) rows.set(l, []);
    rows.get(l).push(id);
    return true;
  };

  const visit = (id) => {
    if (!place(id)) return;
    const spouses = graph.spouses(id).map((s) => s.id).filter((s) => !seen.has(s));
    for (const s of spouses) place(s);

    // Siblings recorded as an explicit edge have no shared parent to hang from, so nothing else
    // in the layout would ever pull them together. Seat them here or they drift apart entirely.
    for (const s of graph.explicitSiblings.get(id)?.values() ?? []) visit(s.id);

    const families = [];
    for (const holder of [id, ...spouses]) {
      for (const fam of graph.familiesOfParent.get(holder) ?? []) {
        if (!families.includes(fam)) families.push(fam);
      }
    }
    for (const fam of families) {
      for (const child of [...fam.children].sort(compare)) visit(child);
    }
  };

  // Start from the shallowest, most connected people so the trunk is laid down before the offcuts.
  const roots = [...members].sort((a, b) => {
    const dl = levels.get(a) - levels.get(b);
    if (dl !== 0) return dl;
    return graph.children(b).length - graph.children(a).length;
  });
  for (const id of roots) visit(id);
  // Anyone reachable only upward (a person whose parents were never walked into) lands here.
  for (const id of roots) place(id);

  return rows;
}

/**
 * Maximal runs of spouses on one row, kept together through every sweep.
 *
 * Somebody married twice goes *between* their partners rather than in front of them. Ordered any
 * other way the two partners end up side by side at couple spacing, and the chart says they were
 * married to each other - the spacing is the notation, so getting it wrong states a falsehood.
 */
function buildBlocks(graph, row) {
  const index = new Map(row.map((id, i) => [id, i]));
  const blocks = [];
  const taken = new Set();

  for (const id of row) {
    if (taken.has(id)) continue;
    const group = [id];
    taken.add(id);
    // Follow the marriages transitively; remarriage chains are rare but do occur.
    for (let i = 0; i < group.length; i++) {
      for (const s of graph.spouses(group[i])) {
        if (!taken.has(s.id) && index.has(s.id)) { group.push(s.id); taken.add(s.id); }
      }
    }

    if (group.length <= 2) { blocks.push({ members: group }); continue; }

    const within = (x) => graph.spouses(x).filter((s) => group.includes(s.id)).length;
    const hub = group.reduce((best, x) => (within(x) > within(best) ? x : best), group[0]);
    const partners = group.filter((x) => x !== hub).sort(byBirth(graph));
    const half = Math.ceil(partners.length / 2);
    blocks.push({ members: [...partners.slice(0, half), hub, ...partners.slice(half)] });
  }
  return blocks;
}

/**
 * Barycentre sweeps.
 *
 * Each block moves to the average position of whatever it connects to on the neighbouring row, and
 * the row is re-sorted. Alternating direction a few times settles the ordering; more passes than
 * this buy nothing visible.
 */
function reduceCrossings(graph, rows, levels) {
  const keys = [...rows.keys()].sort((a, b) => a - b);
  if (keys.length < 2) return;

  const positionIn = (level) => {
    const row = rows.get(level);
    return row ? new Map(row.map((id, i) => [id, i])) : null;
  };

  for (let pass = 0; pass < 8; pass++) {
    const downward = pass % 2 === 0;
    const order = downward ? keys : [...keys].reverse();

    for (const level of order) {
      const neighbourLevel = downward ? level - 1 : level + 1;
      const positions = positionIn(neighbourLevel);
      if (!positions) continue;

      const row = rows.get(level);
      const blocks = buildBlocks(graph, row);
      const current = new Map(row.map((id, i) => [id, i]));

      for (const block of blocks) {
        const seen = [];
        for (const id of block.members) {
          const related = downward
            ? graph.parents(id).map((p) => p.id)
            : graph.children(id).map((c) => c.id);
          for (const other of related) {
            const p = positions.get(other);
            if (p !== undefined) seen.push(p);
          }
        }
        // A block with nothing on the neighbouring row keeps its place rather than drifting to 0.
        block.key = seen.length
          ? seen.reduce((a, b) => a + b, 0) / seen.length
          : current.get(block.members[0]) * (positions.size / Math.max(1, row.length));
        block.tie = current.get(block.members[0]);
      }

      blocks.sort((a, b) => (a.key - b.key) || (a.tie - b.tie));
      rows.set(level, blocks.flatMap((b) => b.members));
    }
  }
}

/* ------------------------------------------------------------------ x assignment */

const blockWidth = (block) =>
  block.members.length * METRICS.NODE_W + (block.members.length - 1) * METRICS.COUPLE_GAP;

/**
 * Places one row, pulling each block toward where it wants to be without letting blocks overlap.
 *
 * Run twice from opposite ends and averaged: a single left-to-right pass jams everything against
 * the left whenever a row is crowded, and averaging the two removes that bias.
 */
function placeRow(blocks, desired) {
  const widths = blocks.map(blockWidth);
  const gap = METRICS.SIBLING_GAP;

  // Left to right: every block as far left as its wish and its neighbour allow.
  const left = [];
  let cursor = -Infinity;
  blocks.forEach((block, i) => {
    const packed = Number.isFinite(cursor) ? cursor : 0;
    const want = desired.has(block) ? desired.get(block) - widths[i] / 2 : packed;
    const x = Math.max(want, cursor);
    left.push(x);
    cursor = x + widths[i] + gap;
  });

  /*
   * Right to left, starting from the extent the first pass reached.
   *
   * A block with nothing pulling on it must nestle against its neighbour rather than keep whatever
   * coordinate it happened to hold: using its own position as its wish makes the placement a
   * ratchet that can only ever move right, which strands anyone childless at the edge of the row.
   */
  const right = new Array(blocks.length);
  const last = blocks.length - 1;
  cursor = left[last] + widths[last];
  for (let i = last; i >= 0; i--) {
    const packed = cursor - widths[i];
    const want = desired.has(blocks[i]) ? desired.get(blocks[i]) - widths[i] / 2 : packed;
    const x = Math.min(want, packed);
    right[i] = x;
    cursor = x - gap;
  }

  // Averaging two feasible placements can breach the minimum gap, so restore it once.
  const out = blocks.map((_, i) => (left[i] + right[i]) / 2);
  cursor = -Infinity;
  for (let i = 0; i < blocks.length; i++) {
    out[i] = Math.max(out[i], cursor);
    cursor = out[i] + widths[i] + gap;
  }
  return out;
}

function assignX(graph, rows) {
  const keys = [...rows.keys()].sort((a, b) => a - b);
  const x = new Map();
  const blocksByLevel = new Map();

  for (const level of keys) {
    const blocks = buildBlocks(graph, rows.get(level));
    blocksByLevel.set(level, blocks);
    let cursor = 0;
    for (const block of blocks) {
      let bx = cursor;
      for (const id of block.members) { x.set(id, bx); bx += METRICS.NODE_W + METRICS.COUPLE_GAP; }
      cursor += blockWidth(block) + METRICS.SIBLING_GAP;
    }
  }

  const centreOf = (id) => x.get(id) + METRICS.NODE_W / 2;
  // Membership is tested once per edge per pass, so it has to be a set lookup rather than a scan
  // of the row - with a few thousand people the difference is seconds.
  const rowSets = new Map(keys.map((level) => [level, new Set(rows.get(level))]));

  for (let pass = 0; pass < 10; pass++) {
    const upward = pass % 2 === 0;
    const order = upward ? [...keys].reverse() : keys;

    for (const level of order) {
      const blocks = blocksByLevel.get(level);
      const neighbours = rowSets.get(level + (upward ? 1 : -1));
      const desired = new Map();

      for (const block of blocks) {
        const targets = [];
        for (const id of block.members) {
          // Going up, a parent wants to sit over the middle of their children; going down, a child
          // wants to sit under the middle of their parents.
          const related = upward
            ? graph.children(id).map((c) => c.id)
            : graph.parents(id).map((p) => p.id);
          for (const other of related) {
            if (neighbours?.has(other) && x.has(other)) targets.push(centreOf(other));
          }
        }
        // A block with no relatives on the neighbouring row states no wish at all; placeRow packs
        // it against its neighbours instead of letting it hold a stale coordinate.
        if (targets.length) {
          desired.set(block, targets.reduce((a, b) => a + b, 0) / targets.length);
        }
      }

      const placed = placeRow(blocks, desired);
      blocks.forEach((block, i) => {
        let bx = placed[i];
        for (const id of block.members) { x.set(id, bx); bx += METRICS.NODE_W + METRICS.COUPLE_GAP; }
      });
    }
  }

  return x;
}

/* ------------------------------------------------------------------ components */

function layoutComponent(graph, members, levels) {
  const local = new Map();
  let min = Infinity;
  for (const id of members) min = Math.min(min, levels.get(id));
  for (const id of members) local.set(id, levels.get(id) - min);

  const rows = initialOrder(graph, members, local);
  reduceCrossings(graph, rows, local);
  const x = assignX(graph, rows);

  let minX = Infinity;
  let maxX = -Infinity;
  for (const id of members) {
    minX = Math.min(minX, x.get(id));
    maxX = Math.max(maxX, x.get(id) + METRICS.NODE_W);
  }

  const depth = Math.max(...members.map((id) => local.get(id))) + 1;
  const nodes = members.map((id) => ({
    id,
    level: local.get(id),
    x: x.get(id) - minX,
    y: local.get(id) * ROW_PITCH,
  }));

  return { nodes, width: maxX - minX, depth, height: depth * ROW_PITCH - METRICS.LEVEL_GAP };
}

/* ------------------------------------------------------------------ the whole archive */

/**
 * Lays out every person in the archive.
 *
 * Components are packed onto shelves rather than strung out in one line: a long row of small
 * families gives an aspect ratio no screen can show, and wrapping them keeps the whole thing
 * roughly the shape of the screen it will be read on. Within a shelf every component shares one
 * generation grid, so the rows line up and the archive reads as strata rather than as debris.
 */
export function layoutArchive(graph, options = {}) {
  const aspect = options.aspect ?? 1.8;
  const levels = assignLevels(graph);

  const connected = graph.components.filter((c) => c.members.length > 1);
  const isolated = graph.isolated;

  const laid = connected
    .map((component) => ({ component, ...layoutComponent(graph, component.members, levels) }))
    .sort((a, b) => b.component.members.length - a.component.members.length
      || b.width - a.width);

  // A shelf width chosen from the total area, so the finished chart is about as wide as it is
  // tall times the aspect - roughly the shape of a screen rather than a ribbon.
  const area = laid.reduce((sum, l) => sum + (l.width + METRICS.GROUP_GAP) * (l.height + METRICS.GROUP_GAP), 0)
    + isolated.length * (METRICS.NODE_W + METRICS.SIBLING_GAP) * (METRICS.NODE_H + METRICS.SIBLING_GAP);
  const widest = laid.length ? Math.max(...laid.map((l) => l.width)) : METRICS.NODE_W;
  const shelfWidth = Math.max(widest, Math.sqrt(Math.max(area, 1) * aspect));

  const nodes = [];
  const groups = [];
  const bands = [];
  let cursorX = METRICS.GUTTER;
  let cursorY = 0;
  let shelfDepth = 0;
  let shelfStartY = 0;
  let shelfIndex = 0;

  const closeShelf = () => {
    if (shelfDepth === 0) return;
    for (let level = 0; level < shelfDepth; level++) {
      bands.push({
        level,
        y: shelfStartY + level * ROW_PITCH,
        x: 0,
        width: cursorX,
        shelf: shelfIndex,
      });
    }
    cursorY = shelfStartY + shelfDepth * ROW_PITCH + METRICS.GROUP_GAP;
    cursorX = METRICS.GUTTER;
    shelfDepth = 0;
    shelfStartY = cursorY;
    shelfIndex++;
  };

  for (const item of laid) {
    if (cursorX > METRICS.GUTTER && cursorX + item.width > shelfWidth) closeShelf();

    const originX = cursorX;
    const originY = shelfStartY;
    for (const node of item.nodes) {
      nodes.push({ ...node, x: node.x + originX, y: node.y + originY, group: groups.length });
    }
    groups.push({
      kind: 'family',
      x: originX - METRICS.GROUP_PAD,
      y: originY - METRICS.GROUP_PAD,
      width: item.width + METRICS.GROUP_PAD * 2,
      height: item.height + METRICS.GROUP_PAD * 2,
      count: item.component.members.length,
      generations: item.depth,
      members: item.component.members,
    });

    cursorX += item.width + METRICS.GROUP_GAP;
    shelfDepth = Math.max(shelfDepth, item.depth);
  }
  closeShelf();

  /*
   * People no edge reaches.
   *
   * The app never draws these at all - a chart of one person's relatives has nowhere to put
   * someone who is nobody's relative. Giving each a component-sized block would waste the screen,
   * so they go in one labelled grid: present and countable, without pretending to a structure the
   * record does not have.
   */
  if (isolated.length) {
    // Shaped by its own count rather than by the shelf: an archive with no connected families at
    // all has a narrow shelf, and it would stack four strangers into a single column.
    const perRow = Math.max(1, Math.min(isolated.length,
      Math.ceil(Math.sqrt(isolated.length * aspect))));
    const originX = METRICS.GUTTER;
    const originY = cursorY + METRICS.GROUP_GAP;
    isolated.forEach((id, i) => {
      nodes.push({
        id,
        level: -1,
        x: originX + (i % perRow) * (METRICS.NODE_W + METRICS.SIBLING_GAP),
        y: originY + Math.floor(i / perRow) * (METRICS.NODE_H + METRICS.SIBLING_GAP),
        group: groups.length,
        isolated: true,
      });
    });
    const rows = Math.ceil(isolated.length / perRow);
    groups.push({
      kind: 'isolated',
      x: originX - METRICS.GROUP_PAD,
      y: originY - METRICS.GROUP_PAD,
      width: Math.min(isolated.length, perRow) * (METRICS.NODE_W + METRICS.SIBLING_GAP)
        - METRICS.SIBLING_GAP + METRICS.GROUP_PAD * 2,
      height: rows * (METRICS.NODE_H + METRICS.SIBLING_GAP) - METRICS.SIBLING_GAP + METRICS.GROUP_PAD * 2,
      count: isolated.length,
      members: isolated,
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = buildLinks(graph, byId);

  let width = 0;
  let height = 0;
  for (const g of groups) { width = Math.max(width, g.x + g.width); height = Math.max(height, g.y + g.height); }

  // Shift everything clear of the margin so nothing touches the edge of a television.
  const dx = METRICS.MARGIN;
  const dy = METRICS.MARGIN;
  for (const n of nodes) { n.x += dx; n.y += dy; }
  for (const g of groups) { g.x += dx; g.y += dy; }
  for (const b of bands) { b.x += dx; b.y += dy; b.width = width + dx; }
  for (const l of links.couples) { l.x1 += dx; l.x2 += dx; l.y += dy; }
  for (const l of links.siblings) { l.x1 += dx; l.x2 += dx; l.y += dy; }
  for (const l of links.descents) {
    l.originX += dx; l.originY += dy; l.busY += dy; l.childTopY += dy;
    l.childXs = l.childXs.map((x) => x + dx);
  }

  return {
    nodes,
    byId,
    groups,
    bands,
    couples: links.couples,
    descents: links.descents,
    siblings: links.siblings,
    levels,
    width: width + dx + METRICS.MARGIN,
    height: height + dy + METRICS.MARGIN,
    metrics: METRICS,
  };
}

/**
 * The connectors.
 *
 * One descent per family rather than per parent, which is what puts a couple's children on a
 * single bar and hangs a half-sibling from their own - the difference between a second marriage
 * you can read and a tangle of crossing lines.
 */
function buildLinks(graph, byId) {
  const couples = [];
  const seen = new Set();
  for (const id of graph.order) {
    const a = byId.get(id);
    if (!a) continue;
    for (const s of graph.spouses(id)) {
      const key = id < s.id ? `${id} ${s.id}` : `${s.id} ${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = byId.get(s.id);
      if (!b || a.y !== b.y) continue;   // drawn only when they actually share a row
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      if (right.x - (left.x + METRICS.NODE_W) > METRICS.SIBLING_GAP * 2.5) continue;
      couples.push({
        x1: left.x + METRICS.NODE_W,
        x2: right.x,
        y: left.y + METRICS.NODE_H / 2,
        subtype: s.subtype,
        a: left.id,
        b: right.id,
      });
    }
  }

  const descents = [];
  for (const fam of graph.families.values()) {
    if (!fam.children.length) continue;
    const parents = fam.parents.map((p) => byId.get(p)).filter(Boolean);
    const children = fam.children.map((c) => byId.get(c)).filter(Boolean);
    if (!parents.length || !children.length) continue;

    const originX = parents.reduce((sum, p) => sum + p.x + METRICS.NODE_W / 2, 0) / parents.length;
    const originY = Math.max(...parents.map((p) => p.y)) + METRICS.NODE_H;
    const childTopY = Math.min(...children.map((c) => c.y));
    // The bus sits just above the shallowest child, so a child placed further down simply gets a
    // longer drop instead of dragging the whole bar out of place.
    const busY = childTopY - METRICS.LEVEL_GAP * 0.42;

    descents.push({
      originX,
      originY,
      busY: Math.max(busY, originY + 12),
      childTopY,
      childXs: children.map((c) => c.x + METRICS.NODE_W / 2),
      childYs: children.map((c) => c.y),
      parents: fam.parents,
      children: fam.children,
    });
  }

  /*
   * Explicit sibling edges exist only where the shared parents are unknown, so there is no descent
   * bar to hang the pair from. They get their own notation: a bracket over the two cards, dashed
   * because what joins them is precisely the part of the record that is missing.
   */
  const siblings = [];
  const drawn = new Set();
  for (const [id, others] of graph.explicitSiblings) {
    const a = byId.get(id);
    if (!a) continue;
    for (const other of others.values()) {
      const key = id < other.id ? `${id} ${other.id}` : `${other.id} ${id}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const b = byId.get(other.id);
      if (!b || a.y !== b.y) continue;
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      siblings.push({
        x1: left.x + METRICS.NODE_W / 2,
        x2: right.x + METRICS.NODE_W / 2,
        y: left.y,
        a: left.id,
        b: right.id,
      });
    }
  }

  return { couples, descents, siblings };
}
