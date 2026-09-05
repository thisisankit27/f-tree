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

/** The short line under a name on the chart. */
export function lifespan(person) {
  const b = /^(\d{4})/.exec(person.birthDate ?? '')?.[1];
  const d = /^(\d{4})/.exec(person.deathDate ?? '')?.[1];
  if (b && d) return `${b}–${d}`;
  if (b) return person.deceased ? `${b}–` : b;
  if (d) return `–${d}`;
  return person.deceased ? 'died' : '';
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

/** Ancestors of a person, with the number of generations up to each. */
function ancestorDistances(graph, id, standIns) {
  const dist = new Map([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    const step = dist.get(current) + 1;
    const above = graph.parents(current).map((p) => p.id);
    const standIn = standIns.get(current);
    if (standIn !== undefined) above.push(standIn);
    for (const parent of above) {
      if (!dist.has(parent)) { dist.set(parent, step); queue.push(parent); }
    }
  }
  return dist;
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

  let term = null;
  const standIns = standInAncestors(graph);
  const mine = ancestorDistances(graph, fromId, standIns);
  const theirs = ancestorDistances(graph, toId, standIns);
  let best = null;
  for (const [ancestor, u] of mine) {
    const d = theirs.get(ancestor);
    if (d === undefined) continue;
    // Prefer the nearest shared ancestor, then the most symmetric pair of distances.
    const score = u + d;
    if (!best || score < best.score
        || (score === best.score && Math.abs(u - d) < Math.abs(best.u - best.d))) {
      best = { ancestor, u, d, score };
    }
  }
  if (best) term = kinshipTerm(best.u, best.d, to);

  const path = shortestPath(graph, fromId, toId);
  return { kind: path ? 'related' : 'none', term, path, via: best?.ancestor ?? null };
}

/** Breadth-first over every edge kind, so in-laws and step-relations are reachable too. */
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
    for (const s of graph.spouses(current)) steps.push({ id: s.id, via: 'spouse', subtype: s.subtype });
    for (const s of graph.siblings(current)) steps.push({ id: s.id, via: 'sibling', half: s.half });

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
    return { id: step.id, label };
  });
}
