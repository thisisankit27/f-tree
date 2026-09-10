/*
 * The family graph, derived from a tree document.
 *
 * The archive stores the minimum: people, and typed edges between them. Everything a reader wants
 * to know - who is whose sibling, which children belong to which marriage, how two people at
 * opposite ends of the tree are related - is derived here rather than stored, for the same reason
 * the app derives it: stored siblings go stale the moment a parent is added.
 */

const PARENT = 'PARENT';
const SPOUSE = 'SPOUSE';
const SIBLING = 'SIBLING';

/** Children are grouped by their *parent set*, which is what makes a second marriage legible. */
function parentSetKey(ids) {
  return [...ids].sort().join(' ');
}

export function buildGraph(doc) {
  const people = new Map();
  for (const p of doc.people) {
    if (people.has(p.id)) continue;   // A duplicate id would be a broken export; first wins.
    people.set(p.id, {
      id: p.id,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null,
      gender: typeof p.gender === 'string' ? p.gender : 'UNSPECIFIED',
      birthDate: p.birthDate || null,
      deathDate: p.deathDate || null,
      deceased: p.deceased === true || Boolean(p.deathDate),
      photo: typeof p.photo === 'string' ? p.photo : null,
      notes: typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim() : null,
      origins: Array.isArray(p.origins) ? p.origins.length : 0,
    });
  }

  const parentsOf = new Map();
  const childrenOf = new Map();
  const spousesOf = new Map();
  const explicitSiblings = new Map();
  const edges = [];

  const add = (map, key, value) => {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Map()));
    if (!set.has(value.id)) set.set(value.id, value);
  };

  let dropped = 0;
  for (const r of doc.relationships) {
    // An edge naming somebody who is not in the file cannot be drawn and must not invent a node.
    if (!people.has(r.from) || !people.has(r.to) || r.from === r.to) { dropped++; continue; }
    const type = r.type === PARENT || r.type === SPOUSE || r.type === SIBLING ? r.type : 'UNKNOWN';
    const subtype = typeof r.subtype === 'string' ? r.subtype : null;

    if (type === PARENT) {
      add(parentsOf, r.to, { id: r.from, subtype });
      add(childrenOf, r.from, { id: r.to, subtype });
      edges.push({ a: r.from, b: r.to, type });
    } else if (type === SPOUSE) {
      add(spousesOf, r.from, { id: r.to, subtype });
      add(spousesOf, r.to, { id: r.from, subtype });
      edges.push({ a: r.from, b: r.to, type });
    } else if (type === SIBLING) {
      add(explicitSiblings, r.from, { id: r.to, subtype });
      add(explicitSiblings, r.to, { id: r.from, subtype });
      edges.push({ a: r.from, b: r.to, type });
    } else {
      dropped++;
    }
  }

  const graph = {
    doc,
    people,
    order: [...people.keys()],
    parentsOf,
    childrenOf,
    spousesOf,
    explicitSiblings,
    edges,
    droppedEdges: dropped,
  };

  graph.parents = (id) => [...(parentsOf.get(id)?.values() ?? [])];
  graph.children = (id) => [...(childrenOf.get(id)?.values() ?? [])];
  graph.spouses = (id) => [...(spousesOf.get(id)?.values() ?? [])];

  /**
   * Siblings derived from shared parents, plus the explicit edges that exist only for siblings
   * whose parents are unknown. Half and full are distinguished by how many parents are shared.
   */
  graph.siblings = (id) => {
    const out = new Map();
    const mine = new Set(graph.parents(id).map((p) => p.id));
    for (const parentId of mine) {
      for (const child of graph.children(parentId)) {
        if (child.id === id || out.has(child.id)) continue;
        const theirs = new Set(graph.parents(child.id).map((p) => p.id));
        let shared = 0;
        for (const p of mine) if (theirs.has(p)) shared++;
        // Two shared parents is unambiguously full. One shared parent is half only when at least
        // one of the two has another parent recorded - otherwise the record simply does not say.
        const half = shared < 2 && (mine.size > 1 || theirs.size > 1);
        out.set(child.id, { id: child.id, half, derived: true });
      }
    }
    for (const s of graph.explicitSiblings.get(id)?.values() ?? []) {
      if (!out.has(s.id)) out.set(s.id, { id: s.id, half: s.subtype === 'HALF', derived: false });
    }
    return [...out.values()];
  };

  buildFamilies(graph);
  buildComponents(graph);
  return graph;
}

/**
 * Family units: a parent set and the children that hang from it, plus childless couples.
 *
 * The layout draws one descent connector per family, so grouping by parent set is what puts a
 * couple's children on one bar and a half-sibling on their own, instead of a tangle of lines.
 */
function buildFamilies(graph) {
  const families = new Map();
  const familiesOfParent = new Map();
  const familyOfChild = new Map();

  const ensure = (parentIds) => {
    const key = parentSetKey(parentIds);
    let fam = families.get(key);
    if (!fam) {
      fam = { key, parents: [...parentIds].sort(), children: [] };
      families.set(key, fam);
      for (const p of fam.parents) {
        let list = familiesOfParent.get(p);
        if (!list) familiesOfParent.set(p, (list = []));
        list.push(fam);
      }
    }
    return fam;
  };

  for (const id of graph.order) {
    const parents = graph.parents(id).map((p) => p.id);
    if (parents.length === 0) continue;
    const fam = ensure(parents);
    fam.children.push(id);
    familyOfChild.set(id, fam);
  }

  // A married couple with no children still forms a unit, so the layout keeps them adjacent.
  for (const id of graph.order) {
    for (const s of graph.spouses(id)) {
      if (s.id < id) continue;
      ensure([id, s.id]);
    }
  }

  graph.families = families;
  graph.familiesOfParent = familiesOfParent;
  graph.familyOfChild = familyOfChild;
}

/** Connected components over every edge kind, so nobody is dropped for being unconnected. */
function buildComponents(graph) {
  const seen = new Map();
  const adjacency = new Map();
  const link = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a).push(b);
  };
  for (const e of graph.edges) { link(e.a, e.b); link(e.b, e.a); }

  const components = [];
  for (const id of graph.order) {
    if (seen.has(id)) continue;
    const members = [];
    const queue = [id];
    seen.set(id, components.length);
    while (queue.length) {
      const current = queue.pop();
      members.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) { seen.set(next, components.length); queue.push(next); }
      }
    }
    components.push({ index: components.length, members });
  }

  graph.components = components;
  graph.componentOf = seen;
  // People with no edge at all. The app never shows these; showing them is the point of this page.
  graph.isolated = components.filter((c) => c.members.length === 1).map((c) => c.members[0]);
}

/* ------------------------------------------------------------------ display helpers */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** Mirrors PartialDate.display: 1938, April 1938, 17 April 1938 - never more precise than known. */
export function displayDate(value) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value ?? '');
  if (!m) return null;
  const [, y, mo, d] = m;
  if (!mo) return y;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return y;
  return d ? `${Number(d)} ${month} ${y}` : `${month} ${y}`;
}

export function birthYear(person) {
  const m = /^(\d{4})/.exec(person.birthDate ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * The short line under a name on the chart.
 *
 * "Late" rather than "died" where nothing but the fact is known: it sits directly beneath the name
 * and is read as part of it, so the honorific is both the respectful word and the grammatical one.
 */
export function lifespan(person) {
  const b = /^(\d{4})/.exec(person.birthDate ?? '')?.[1];
  const d = /^(\d{4})/.exec(person.deathDate ?? '')?.[1];
  if (b && d) return `${b}–${d}`;
  if (b) return person.deceased ? `${b}–` : b;
  if (d) return `–${d}`;
  return person.deceased ? 'Late' : '';
}

/** Whole years lived, or reached so far. Derived, never stored, exactly as the app does it. */
export function ageOf(person) {
  const b = birthYear(person);
  if (!b) return null;
  const d = /^(\d{4})/.exec(person.deathDate ?? '')?.[1];
  // A date in the future, or a death before a birth, is a typo rather than an age. Saying nothing
  // is the honest answer; "-104 years" is not.
  const age = d ? Number(d) - b : person.deceased ? null : new Date().getFullYear() - b;
  return age === null || age < 0 ? null : age;
}

export function displayName(person) {
  return person.name ?? 'Unknown';
}

export function initials(person) {
  if (!person.name) return '?';
  return person.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

/* ------------------------------------------------------------------ naming relationships */

const byGender = (person, male, female, neutral) =>
  person?.gender === 'MALE' ? male : person?.gender === 'FEMALE' ? female : neutral;

const PARENT_PREFIX = { ADOPTIVE: 'Adoptive', STEP: 'Step', FOSTER: 'Foster' };

const capitalise = (s) => s[0].toUpperCase() + s.slice(1);

export function parentLabel(parent, subtype) {
  const base = byGender(parent, 'father', 'mother', 'parent');
  const prefix = PARENT_PREFIX[subtype];
  return prefix ? `${prefix} ${base}` : capitalise(base);
}

export function childLabel(child, subtype) {
  const base = byGender(child, 'son', 'daughter', 'child');
  const prefix = PARENT_PREFIX[subtype];
  return prefix ? `${prefix} ${base}` : capitalise(base);
}

export function siblingLabel(sibling, half) {
  const base = byGender(sibling, 'brother', 'sister', 'sibling');
  return half ? `Half-${base}` : capitalise(base);
}

export function spouseLabel(spouse, subtype) {
  if (subtype === 'DIVORCED') return byGender(spouse, 'Former husband', 'Former wife', 'Former partner');
  // WIDOWED sits on a symmetric edge and cannot say which of the two died, so the deceased flag
  // decides. Calling a living spouse "late" because their partner died states the opposite of
  // what happened.
  if (subtype === 'WIDOWED' && spouse?.deceased) {
    return byGender(spouse, 'Late husband', 'Late wife', 'Late partner');
  }
  if (subtype === 'PARTNER') return 'Partner';
  return byGender(spouse, 'Husband', 'Wife', 'Spouse');
}

/** Every recorded relationship of one person, grouped and named the way the app names them. */
export function relationsOf(graph, id) {
  const person = graph.people.get(id);
  if (!person) return [];
  const groups = [];
  const push = (heading, items) => { if (items.length) groups.push({ heading, items }); };

  push('Parents', graph.parents(id).map((p) => ({
    id: p.id, label: parentLabel(graph.people.get(p.id), p.subtype),
  })));
  push('Partners', graph.spouses(id).map((s) => ({
    id: s.id, label: spouseLabel(graph.people.get(s.id), s.subtype),
  })));
  push('Siblings', graph.siblings(id).map((s) => ({
    id: s.id, label: siblingLabel(graph.people.get(s.id), s.half),
  })));
  push('Children', graph.children(id).map((c) => ({
    id: c.id, label: childLabel(graph.people.get(c.id), c.subtype),
  })));
  return groups;
}

/* ------------------------------------------------------------------ how are these two related */

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

const ordinal = (n) => ORDINALS[n] ?? `${n}th`;

const greats = (n) => (n <= 0 ? '' : 'great-'.repeat(n));

/**
 * The English kinship term for a blood relationship, from up/down distances to a common ancestor.
 *
 * u is generations up from the subject to the shared ancestor, d is generations back down to the
 * other person. Everything a family actually says out loud falls out of these two numbers.
 */
export function kinshipTerm(u, d, other) {
  if (u === 0 && d === 0) return 'the same person';
  if (u === 0) {
    if (d === 1) return byGender(other, 'son', 'daughter', 'child');
    return `${greats(d - 2)}grand${byGender(other, 'son', 'daughter', 'child')}`;
  }
  if (d === 0) {
    if (u === 1) return byGender(other, 'father', 'mother', 'parent');
    return `${greats(u - 2)}grand${byGender(other, 'father', 'mother', 'parent')}`;
  }
  if (u === 1 && d === 1) return byGender(other, 'brother', 'sister', 'sibling');
  if (d === 1) return `${greats(u - 2)}${byGender(other, 'uncle', 'aunt', 'aunt or uncle')}`;
  if (u === 1) return `${greats(d - 2)}${byGender(other, 'nephew', 'niece', 'nephew or niece')}`;

  const degree = Math.min(u, d) - 1;
  const removed = Math.abs(u - d);
  const base = `${ordinal(degree)} cousin`;
  if (removed === 0) return base;
  if (removed === 1) return `${base} once removed`;
  if (removed === 2) return `${base} twice removed`;
  return `${base} ${removed} times removed`;
}

/**
 * A stand-in parent for each group of people joined by explicit sibling edges.
 *
 * An explicit SIBLING edge is only recorded when the parents are *not* known - shared parents
 * derive siblings on their own. So the edge is a statement that these people share an ancestor
 * nobody wrote down, and without somebody to measure through, an aunt reachable only through her
 * brother comes back as merely "related": the gap in the record swallowing a word the family uses
 * every day. Whole groups, not pairs - three siblings recorded as two edges share one unknown
 * parent, and a stand-in per edge would make the outer two cousins.
 *
 * The stand-in is never shown. It has no name to show, which is the point of it.
 */
function standInAncestors(graph) {
  const groupOf = new Map();
  const members = new Map();
  for (const [id, siblings] of graph.explicitSiblings) {
    for (const s of siblings.values()) {
      const a = id;
      const b = s.id;
      const left = groupOf.get(a);
      const right = groupOf.get(b);
      if (left === undefined && right === undefined) {
        const key = `unrecorded-parent:${members.size}`;
        groupOf.set(a, key); groupOf.set(b, key);
        members.set(key, [a, b]);
      } else if (left === undefined) {
        groupOf.set(a, right); members.get(right).push(a);
      } else if (right === undefined) {
        groupOf.set(b, left); members.get(left).push(b);
      } else if (left !== right) {
        for (const m of members.get(right)) groupOf.set(m, left);
        members.get(left).push(...members.get(right));
        members.delete(right);
      }
    }
  }
  return groupOf;
}

/**
 * The stand-ins for one graph, worked out once.
 *
 * `standInAncestors` walks every explicit sibling edge in the file and unions them into groups. It
 * was being called on every `relate`, and again inside `bloodTerm` for the same graph, which on a
 * large tree is the same union-find run over and over to produce the same answer.
 *
 * Hung off the graph rather than kept in a module-level cache, so it lives exactly as long as the
 * graph does. `buildGraph` makes a new one on every edit, and a cache that outlived an edit would
 * answer about a tree that no longer exists.
 */
function standInsFor(graph) {
  if (!graph.__standIns) {
    Object.defineProperty(graph, '__standIns', {
      value: standInAncestors(graph), enumerable: false, writable: false,
    });
  }
  return graph.__standIns;
}

/**
 * Ancestors of a person: how many generations up each one is, and the way there.
 *
 * The route is what this adds. The arithmetic that names an English relationship needs only two
 * numbers -- steps up and steps down -- and throws the path away, but Hindi asks questions the
 * numbers cannot answer: which side of the family, and through whom. मामा and चाचा are both
 * "uncle" at (2, 1); which word is right depends on whether the route ran through a mother or a
 * father.
 *
 * Nothing reads `route` yet. It is here so that the search happens once, in one place, rather than
 * being written a third time when the Hindi vocabulary lands.
 */
function ancestorRoutes(graph, id, standIns) {
  const routes = new Map([[id, { up: 0, route: [] }]]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    const here = routes.get(current);
    const above = graph.parents(current).map((p) => p.id);
    const standIn = standIns.get(current);
    if (standIn !== undefined) above.push(standIn);
    for (const parent of above) {
      if (routes.has(parent)) continue;
      routes.set(parent, { up: here.up + 1, route: [...here.route, parent] });
      queue.push(parent);
    }
  }
  return routes;
}

/**
 * The ancestor two people are best measured through, or null if they share none.
 *
 * "Best" is the nearest -- fewest steps in total -- and where two are equally near, the most
 * symmetric pair of distances. That second rule matters in a family that has married within itself:
 * two people can share a grandfather on one side and a great-great-grandmother on another, and
 * naming the relationship through the nearer one is what makes them cousins rather than something
 * nobody says.
 *
 * This loop was written out twice, here and in `bloodTerm`, character for character. Two copies of
 * a tie-break rule is one copy waiting to be changed alone.
 */
function nearestSharedAncestor(graph, fromId, toId, standIns) {
  const mine = ancestorRoutes(graph, fromId, standIns);
  const theirs = ancestorRoutes(graph, toId, standIns);

  let best = null;
  for (const [ancestor, here] of mine) {
    const there = theirs.get(ancestor);
    if (there === undefined) continue;
    const u = here.up;
    const d = there.up;
    const score = u + d;
    if (!best || score < best.score
        || (score === best.score && Math.abs(u - d) < Math.abs(best.u - best.d))) {
      best = { ancestor, u, d, score, ascent: here.route, descent: there.route };
    }
  }
  return best;
}

/**
 * How two people are related.
 *
 * Answers in two registers, because they serve different readers: a kinship term when a blood
 * relationship exists ("first cousin once removed"), and always the explicit chain of steps, which
 * is the only form that can express in-laws, step-relations and the long way round.
 */
export function relate(graph, fromId, toId) {
  if (fromId === toId) return { kind: 'same' };

  const to = graph.people.get(toId);
  if (!graph.people.get(fromId) || !to) return { kind: 'none' };

  const standIns = standInsFor(graph);
  const best = nearestSharedAncestor(graph, fromId, toId, standIns);
  const term = best ? kinshipTerm(best.u, best.d, to) : null;

  const path = shortestPath(graph, fromId, toId);
  if (!path) return { kind: 'none', term, path, via: best?.ancestor ?? null };

  // No blood between them, but one marriage at one end of the line still has a name.
  const affinal = term ? null : affinalTerm(graph, fromId, toId, path, standIns);
  return {
    kind: 'related',
    term: term ?? affinal?.term ?? null,
    marriedTo: affinal?.marriedTo ?? null,
    ofSpouse: affinal?.ofSpouse ?? null,
    path,
    via: best?.ancestor ?? null,
  };
}

/** The blood term between two people, ignoring the line the search happened to take. */
function bloodTerm(graph, fromId, toId, standIns, other) {
  const best = nearestSharedAncestor(graph, fromId, toId, standIns);
  return best ? kinshipTerm(best.u, best.d, other) : null;
}

/**
 * The word for a relationship that runs through exactly one marriage.
 *
 * A marriage at one *end* of the line is nameable: everybody on the far side of it is a blood
 * relative of somebody, and English hangs a word off that - my uncle's wife is my aunt, my wife's
 * mother my mother-in-law. A marriage in the *middle* is not, and no amount of wanting makes it so:
 * "my aunt's husband's brother" is what he is, and the chain says it better than any invented word.
 *
 * Where the end is nameable but English has no single word for it - a first cousin's wife - the
 * pieces come back separately so the page can say who they married instead.
 */
function affinalTerm(graph, fromId, toId, path, standIns) {
  const spouseSteps = path.filter((s) => s.via === 'spouse');
  if (spouseSteps.length !== 1) return null;
  const at = path.findIndex((s) => s.via === 'spouse');
  const to = graph.people.get(toId);

  if (path.length === 1) return { term: spouseLabel(to, null).toLowerCase() };

  if (at === path.length - 1) {
    const married = graph.people.get(path[path.length - 2].id);
    const relative = bloodTerm(graph, fromId, married.id, standIns, married);
    if (!relative) return null;
    const named = inLawTerm(relative, to, 'spouse-of');
    return named ? { term: named } : { marriedTo: { term: relative, person: married } };
  }

  if (at === 0) {
    const spouse = graph.people.get(path[0].id);
    const relative = bloodTerm(graph, spouse.id, toId, standIns, to);
    if (!relative) return null;
    const named = inLawTerm(relative, to, 'of-spouse');
    return named ? { term: named } : { ofSpouse: { term: relative, spouse } };
  }
  return null;
}

/**
 * The single word English has for a close relationship through marriage, or null.
 *
 * It names the near ones and nothing past them. Null is the useful answer for the rest: it is what
 * tells the page to say who somebody married rather than reach for a word nobody says.
 */
function inLawTerm(relative, other, direction) {
  const isUncleAunt = /(^|-)(uncle|aunt)$/.test(relative) || relative === 'aunt or uncle';
  const isSibling = relative === 'brother' || relative === 'sister' || relative === 'sibling';
  const isParent = relative === 'father' || relative === 'mother' || relative === 'parent';
  const isChild = relative === 'son' || relative === 'daughter' || relative === 'child';

  if (direction === 'spouse-of') {
    // A parent's sibling's spouse is simply an aunt or an uncle, and always has been.
    if (isUncleAunt) {
      const greatCount = (relative.match(/great-/g) ?? []).length;
      return 'great-'.repeat(greatCount) + byGender(other, 'uncle', 'aunt', 'aunt or uncle');
    }
    if (isSibling) return byGender(other, 'brother-in-law', 'sister-in-law', 'sibling-in-law');
    if (isParent) return byGender(other, 'stepfather', 'stepmother', 'step-parent');
    if (isChild) return byGender(other, 'son-in-law', 'daughter-in-law', 'child-in-law');
    return null;
  }
  if (isParent) return byGender(other, 'father-in-law', 'mother-in-law', 'parent-in-law');
  if (isSibling) return byGender(other, 'brother-in-law', 'sister-in-law', 'sibling-in-law');
  if (isChild) return byGender(other, 'stepson', 'stepdaughter', 'stepchild');
  return null;
}

/**
 * The shortest chain of relationships joining two people, over every kind of edge.
 *
 * Breadth-first over every edge kind, so in-laws and step-relations are reachable too. Marriage is
 * walked as well as blood, because "my wife's mother" is exactly the sort of question this feature
 * is asked, and no blood-only search can answer it.
 *
 * The order the neighbours are enqueued in is the Kotlin's, and it is load-bearing rather than
 * arbitrary -- see `Kinship.kt:441-444` and the note above it. Blood steps go in before marriage
 * ones so that where two routes are the same length the one through the family wins: arriving at a
 * cousin through their spouse would be a true answer and a useless one.
 *
 * It can only matter where two routes tie, since this is breadth-first and a shorter route wins
 * whatever the order. Ties are not rare -- two brothers marrying two sisters produces one -- and
 * `kinship-golden.txt` holds that shape on purpose.
 */
function shortestPath(graph, fromId, toId) {
  const previous = new Map([[fromId, null]]);
  const queue = [fromId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current === toId) break;

    const steps = [];
    for (const p of graph.parents(current)) steps.push({ id: p.id, via: 'parent', subtype: p.subtype });
    for (const c of graph.children(current)) steps.push({ id: c.id, via: 'child', subtype: c.subtype });
    // Siblings before spouses: blood before marriage, matching Kinship.kt:441-444.
    for (const s of graph.siblings(current)) steps.push({ id: s.id, via: 'sibling', half: s.half });
    for (const s of graph.spouses(current)) steps.push({ id: s.id, via: 'spouse', subtype: s.subtype });

    for (const step of steps) {
      if (previous.has(step.id)) continue;
      previous.set(step.id, { from: current, ...step });
      queue.push(step.id);
    }
  }
  if (!previous.has(toId)) return null;

  const chain = [];
  let cursor = toId;
  while (previous.get(cursor)) {
    const step = previous.get(cursor);
    chain.unshift(step);
    cursor = step.from;
  }
  return chain.map((step) => {
    const person = graph.people.get(step.id);
    let label;
    if (step.via === 'parent') label = parentLabel(person, step.subtype).toLowerCase();
    else if (step.via === 'child') label = childLabel(person, step.subtype).toLowerCase();
    else if (step.via === 'spouse') label = spouseLabel(person, step.subtype).toLowerCase();
    else label = siblingLabel(person, step.half).toLowerCase();
    // `via` is carried through: a chart needs to know which steps are sibling ones, because those
    // are the steps with no edge of their own to draw.
    return { id: step.id, label, via: step.via };
  });
}

/**
 * The people a chart needs before it can draw a relation.
 *
 * The chain alone is not always drawable. Siblings are derived from the parent they share, so a
 * sibling step carries no edge of its own: draw only the chain and two siblings arrive as two loose
 * cards with nothing between them, which is precisely the question the reader asked. Their shared
 * parent is the missing element, so it is drawn - "my father's sister" needs my grandfather on the
 * page and does not need him in the sentence. An explicit sibling edge needs nobody added; it
 * carries its own bracket, drawn exactly because the parents are not known.
 */
export function peopleToDraw(graph, fromId, path) {
  const drawn = new Set([fromId]);
  let previous = fromId;
  for (const step of path) {
    drawn.add(step.id);
    if (step.via === 'sibling') {
      const theirs = new Set(graph.parents(step.id).map((p) => p.id));
      for (const p of graph.parents(previous)) if (theirs.has(p.id)) drawn.add(p.id);
    }
    previous = step.id;
  }
  return drawn;
}

/**
 * The same archive cut down to a set of people, keeping only the edges with both ends still in it.
 *
 * Rebuilt from a filtered document rather than by trimming the graph in place, so everything
 * derived - siblings especially - is derived again from what is left, and the cut-down graph states
 * only what it can still show.
 */
export function restrictedGraph(graph, ids) {
  const keep = ids instanceof Set ? ids : new Set(ids);
  return buildGraph({
    ...graph.doc,
    people: graph.doc.people.filter((p) => keep.has(p.id)),
    relationships: graph.doc.relationships.filter((r) => keep.has(r.from) && keep.has(r.to)),
  });
}
