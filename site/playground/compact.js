/*
 * One person's family, arranged for reading rather than for drawing.
 *
 * This is the third reading of a tree, and the only one that is composed rather than painted. The
 * charts are pictures: to read a name you zoom, to reach a relative you pan, and a canvas holds
 * nothing at all for a screen reader -- which is why the chart describes itself and then points at
 * the people list. But that list is alphabetical and has no family in it. Between "a picture you
 * must zoom" and "a list with no shape" there was nothing, and this is the missing middle: the same
 * people the focused selection chooses, as text that can be read at any size.
 *
 * Ported from `app/.../graph/CompactFamily.kt`, with its test table. `CompactFamily.from` consumes
 * only ids and levels, so none of the placement arithmetic came with it -- `collectFocused` in
 * `focus.js` supplies the levels, and this file supplies the arrangement.
 */

import { birthYear } from './model.js';
import { collectFocused } from './focus.js';

/** Sorts last, so an undated placeholder never displaces the eldest. */
const UNDATED = Number.MAX_SAFE_INTEGER;

/** Sorts after every real name, for the same reason. */
const UNNAMED = '￿';

/**
 * One block on a row: a person, a couple, or somebody with the two people they married.
 *
 * The chart lays a marriage out as a single unit joined by a doubled rule, because a couple that
 * drifts apart on screen stops looking like a couple. There are no coordinates here to drift, so
 * the same idea is expressed in the data: everybody joined by a marriage on this row comes out as
 * one group, in the order they are read across it.
 *
 * `links` says which neighbours are actually married -- `links[i]` joins `people[i]` to
 * `people[i + 1]`. It is not always every gap. Somebody who married twice puts three people in one
 * group and only two of the three pairs are marriages; drawing the mark between all of them would
 * state a wedding that never happened.
 *
 * `ofBand` is who belongs to the row by *descent*. A step-grandmother is family and is shown, but
 * she is not a fifth grandparent, and the heading counts grandparents.
 */
export class CompactGroup {
  constructor(people, links, ofBand) {
    this.people = people;
    this.links = links;
    this.ofBand = ofBand;
  }

  get ids() { return this.people.map((p) => p.id); }

  /** True when `people[index]` and `people[index + 1]` are married to each other. */
  married(index) { return this.links[index] === true; }
}

/**
 * One generation, at a distance from the person the view is centred on.
 *
 * `offset` is generations from the focus: -1 is their parents, +1 their children, 0 the row they
 * stand in themselves. Bands are keyed by the number rather than by a name, so "three generations
 * up" needs no new case -- the heading is worked out from the offset when it is drawn.
 */
export class CompactBand {
  constructor(offset, groups) {
    this.offset = offset;
    this.groups = groups;
  }

  /** What the heading counts: people who are of this generation, not married into it. */
  get count() { return this.groups.reduce((sum, g) => sum + g.ofBand.size, 0); }

  get isEmpty() { return this.groups.length === 0; }
}

/**
 * A person and whoever they married, for the one place a couple is read downwards.
 *
 * The centre of the view is a block of its own rather than a card in a row, so its marriages are
 * listed under it and each is unambiguous. The bands need `CompactGroup` instead, because there a
 * couple runs across the page.
 */
export class CompactMember {
  constructor(person, partners = []) {
    this.person = person;
    this.partners = partners;
  }

  get ids() { return [this.person.id, ...this.partners.map((p) => p.id)]; }
}

export class CompactFamily {
  constructor({ focus = null, bands = [], truncated = false } = {}) {
    this.focus = focus;
    this.bands = bands;
    this.truncated = truncated;
  }

  get isEmpty() { return this.focus === null; }

  band(offset) { return this.bands.find((b) => b.offset === offset) ?? null; }

  /** Generations above the focus, oldest first. */
  get ancestors() { return this.bands.filter((b) => b.offset < 0); }

  /** Generations below the focus, nearest first. */
  get descendants() { return this.bands.filter((b) => b.offset > 0); }

  /** The focus's own row, without the focus or their partners: brothers and sisters. */
  get siblings() { return this.band(0); }

  /** Everybody shown, focus included. Used to check this view against the selection it came from. */
  get everyone() {
    const out = this.focus ? [...this.focus.ids] : [];
    for (const band of this.bands) for (const group of band.groups) out.push(...group.ids);
    return out;
  }
}

/**
 * Rearranges a focused selection into generation bands.
 *
 * `collectFocused` supplies who is on the chart and which row they stand in; the graph supplies the
 * marriages. Pure, so the view can be rebuilt on any edit without touching anything else.
 *
 * Pass `selection` to reuse a selection already made -- the desktop does, so that "show more
 * generations" does not walk the graph twice.
 */
export function compactFamily(graph, focusId, { up = 3, down = 3, selection = null } = {}) {
  const included = selection ?? collectFocused(graph, focusId, { up, down });
  if (included.focusId === null) return new CompactFamily();

  const focusPerson = graph.people.get(included.focusId);
  if (!focusPerson) return new CompactFamily();

  const levelOf = included.levels;
  const peopleByLevel = new Map();
  for (const [id, level] of levelOf) {
    if (!peopleByLevel.has(level)) peopleByLevel.set(level, []);
    peopleByLevel.get(level).push(id);
  }

  const spousesOf = (id) => graph.spouses(id).map((s) => s.id);

  /*
   * Who belongs to a row by descent, as opposed to by marriage.
   *
   * Walked one generation at a time from the focus's own row outwards, following the same lines the
   * selection followed: parents of the row above, children of the row below. A spouse is reached by
   * neither, which is exactly what makes them a partner -- and is how a step-grandparent stays
   * visible without being counted as a grandparent.
   */
  const ownRow = new Set([included.focusId]);
  for (const s of graph.siblings(included.focusId)) {
    if (levelOf.get(s.id) === 0) ownRow.add(s.id);
  }
  const descentAt = new Map([[0, ownRow]]);

  const walk = (step, direction) => {
    let frontier = ownRow;
    let row = direction;
    while (peopleByLevel.has(row)) {
      const next = new Set();
      for (const id of frontier) {
        for (const reached of step(id)) if (levelOf.get(reached) === row) next.add(reached);
      }
      descentAt.set(row, next);
      frontier = next;
      row += direction;
    }
  };
  walk((id) => graph.parents(id).map((p) => p.id), -1);
  walk((id) => graph.children(id).map((c) => c.id), 1);

  const focus = new CompactMember(
    focusPerson,
    spousesOf(included.focusId)
      .filter((id) => levelOf.get(id) === 0)
      .map((id) => graph.people.get(id))
      .filter(Boolean)
      .sort(readingOrder),
  );

  // The centre is drawn as the view's own block, so its row lists only who stands beside it.
  // Everybody else on that row still appears.
  const spokenFor = new Set(focus.ids);

  const bands = [];
  for (const level of [...peopleByLevel.keys()].sort((a, b) => a - b)) {
    const here = new Set(
      peopleByLevel.get(level).filter((id) => level !== 0 || !spokenFor.has(id)),
    );
    const byDescent = new Set([...(descentAt.get(level) ?? [])].filter((id) => here.has(id)));

    const groups = marriageGroups(here, spousesOf)
      .map((group) => {
        const order = readAcross(group, byDescent, graph, spousesOf);
        const people = order.map((id) => graph.people.get(id)).filter(Boolean);
        const links = order.slice(0, -1)
          .map((id, i) => spousesOf(id).includes(order[i + 1]));
        return new CompactGroup(
          people,
          links,
          new Set(order.filter((id) => byDescent.has(id))),
        );
      })
      .sort(groupOrder(graph));

    if (groups.length > 0) bands.push(new CompactBand(level, groups));
  }

  return new CompactFamily({ focus, bands, truncated: included.truncated });
}

/**
 * Everyone on a row who is joined, directly or through somebody else, by a marriage.
 *
 * The seed is taken in sorted order rather than in the order the row happened to be built. The
 * Kotlin takes whatever its LinkedHashSet offers first; the groups it finds are connected
 * components either way, so the *membership* cannot differ -- only which group is emitted first,
 * and `groupOrder` decides that afterwards. Sorting here just means two runs on the same file walk
 * the row identically.
 */
function marriageGroups(row, spousesOf) {
  const remaining = new Set([...row].sort());
  const groups = [];
  while (remaining.size > 0) {
    const seed = remaining.values().next().value;
    const group = new Set([seed]);
    const queue = [seed];
    while (queue.length > 0) {
      for (const spouse of spousesOf(queue.shift())) {
        if (remaining.has(spouse) && !group.has(spouse)) { group.add(spouse); queue.push(spouse); }
      }
    }
    for (const id of group) remaining.delete(id);
    groups.push(group);
  }
  return groups;
}

/**
 * The order a marriage group is read across the row.
 *
 * Walked along the marriages themselves, starting from somebody at the end of the chain, so that a
 * person who married twice ends up *between* their two spouses rather than beside one of them with
 * the other stranded. That is what lets the doubled rule be drawn only where there really is a
 * marriage.
 *
 * Where the chain could start at either end it starts with somebody the band is about, so a row of
 * brothers and sisters leads with the sister rather than with the man she married. Remaining ties
 * break on birth and then on id: a row that reshuffles itself when the window is resized is
 * disorienting for no reason.
 */
function readAcross(group, byDescent, graph, spousesOf) {
  if (group.size <= 1) return [...group];

  const within = new Map(
    [...group].map((id) => [id, spousesOf(id).filter((s) => group.has(s)).sort()]),
  );
  const birthOf = (id) => birthYear(graph.people.get(id) ?? {}) ?? UNDATED;

  const start = [...group].sort(by(
    (id) => within.get(id).length,
    (id) => (byDescent.has(id) ? 0 : 1),
    (id) => birthOf(id),
    (id) => id,
  ))[0];

  const order = [];
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    order.push(next);
    const neighbours = within.get(next)
      .filter((id) => !seen.has(id))
      .sort(by((id) => within.get(id).length, (id) => birthOf(id)));
    /*
     * `neighbours.forEach { queue.addFirst(it) }`, exactly as the Kotlin has it.
     *
     * Pushing a, then b, then c to the *front* leaves the queue as c, b, a -- so the walk carries
     * on with the LAST of the sorted neighbours, not the first. Reversing first to "fix" that
     * reads more natural and produces the opposite order, which is what this did until a group
     * containing somebody married three times was tested. Every smaller group passes either way.
     */
    for (const id of neighbours) queue.unshift(id);
  }
  // Anyone the walk could not reach -- impossible for a connected group, but the row is more
  // useful missing a mark than missing a person.
  order.push(...[...group].filter((id) => !seen.has(id)).sort());
  return order;
}

/**
 * Groups run oldest first, judged on the people the band is actually about.
 *
 * Birth order is how a family lists a generation aloud, and in Hindi it is a kinship fact in its
 * own right -- an elder and a younger brother are different words. Someone with no recorded birth
 * year sorts last, so an undated placeholder never displaces the eldest.
 */
function groupOrder(graph) {
  const yearOf = (id) => birthYear(graph.people.get(id) ?? {}) ?? UNDATED;
  return by(
    (group) => {
      const counted = group.ofBand.size > 0 ? [...group.ofBand] : group.ids;
      return Math.min(...counted.map(yearOf));
    },
    (group) => group.people[0]?.name?.toLowerCase() ?? UNNAMED,
    (group) => group.ids[0],
  );
}

const readingOrder = by(
  (person) => birthYear(person) ?? UNDATED,
  (person) => person.name?.toLowerCase() ?? UNNAMED,
  (person) => person.id,
);

/** `compareBy` with several keys, as Kotlin has it: the first key that differs decides. */
function by(...keys) {
  return (a, b) => {
    for (const key of keys) {
      const ka = key(a);
      const kb = key(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
    }
    return 0;
  };
}
