/*
 * The featured person's family, in circles (#250).
 *
 * The story is told around one person, F (`featured.js`), and every chapter after the opening is a
 * circle of people around them: parents, grandparents on each side, siblings, spouses, children,
 * cousins' houses along the lane, and the people the record does not join to F at all. This module
 * decides, once per book, which circle each person belongs to, so no chapter ever recomputes
 * kinship on its own and nobody is counted twice or dropped.
 *
 * ## How
 *
 * One typed walk out from F. Each stage claims people for one circle, and **the first claim wins**:
 * once somebody has a circle, no later stage can take them. That is what makes the result a
 * partition - every person in scope lands in exactly one circle - even on bad data, where one
 * person can be two things at once (a cousin who married F, a record with a parent loop).
 *
 * The claim order (`CIRCLES`), nearest first, blood before marriage:
 *
 *   1. self          F
 *   2. parents       F's parents (any parent edge: birth, step, adoptive, foster)
 *   3. spouses       F's spouses: current, former, late
 *   4. children      F's children, grouped by the other parent
 *   5. siblings      full, half (grouped by the parents they share) and explicit sibling links,
 *                    followed transitively through full siblings (F's brother's explicit
 *                    sister is F's sister too; a half-sibling's is not)
 *   6. grandparents  the parents of F's parents, per side
 *   7. descendants   F's grandchildren and beyond
 *   8. ancestors     beyond the grandparents, per side where the record says
 *   9. branches      one per aunt or uncle (a parent's sibling): `branchFrom` of them - their
 *                    spouses, everyone below them and their spouses: F's cousins and families
 *  10. in-laws       one marriage from the core: spouse's parents and siblings, siblings' and
 *                    children's spouses, a parent's other spouse, a spouse's other children
 *  11. lane          everyone else joined to F by any chain of links
 *  12. elsewhere     people in scope the record does not join to F at all
 *
 * Every walk visits a person at most once and reads each of their links once, so the partition is
 * O(V + E). Every neighbour list is sorted by id before it is walked, so ties are settled by the
 * record's ids, never by the order the file happened to list things in: the same tree in any order
 * gives the same circles.
 *
 * ## What it returns: `kinOf(family, featuredId, options)`
 *
 *   {
 *     featured: id | null,
 *     people:   Map<id, Entry>          // everyone in scope, exactly once, in circle order
 *     circles:  { [circle]: id[] }      // every name in CIRCLES is a key; arrays may be empty
 *     words(id) -> Words | null          // kin words, lazily, at most one relate() per person
 *   }
 *
 *   Entry {
 *     id,
 *     circle,           // one of CIRCLES
 *     role,             // what they are within it (ROLES below)
 *     side,             // 'paternal' | 'maternal' | 'none'
 *     gen,              // generation offset from F: -1 a parent, 0 F's own row, +1 a child;
 *                       // null for 'elsewhere' (and anyone reached only from there)
 *     branch,           // the group key within the circle, or null (see below)
 *     via,              // the person they were reached from, or null (F, elsewhere)
 *     namedBy,          // { id, word } for a person with no recorded name: the named relative
 *                       // they are named through ("Shyam Lal's wife" = { id: shyam, word: 'wife' });
 *                       // null when they have a name, or when no named neighbour exists
 *   }
 *
 *   `branch`, per circle:
 *     parents, self, spouses, elsewhere    null
 *     children, siblings (derived)         the child's own parent-set key (`graph.families`' key:
 *                                          parent ids, sorted, space-joined) - F's children by
 *                                          one partner share one key, a half-sibling group another
 *     siblings (explicit)                  null: the parents are not recorded
 *     grandparents, ancestors              the id of F's parent the line goes up through
 *     descendants                          the id of F's child the line comes down through
 *     branches                             the aunt's or uncle's id: one branch, one house
 *     in-laws                              the core person the marriage hangs off (the spouse, the
 *                                          sibling, the child, the parent)
 *     lane                                 the first non-lane person the walk reached them from
 *
 *   Each `circles[c]` is sorted by: side (paternal, maternal, none); branch, with branches ordered
 *   by their eldest member; generation; birth year (unknown last); name (by family.js's `sortKey`,
 *   unnamed last); id. So consecutive entries with the same `branch` are one group.
 *
 *   Words { en, hi, term, word, through }
 *     en    the English kin word, lower case ("father", "half-sister", "first cousin", "aunt",
 *           "former wife"), or null where English has no single word
 *     hi    the Hindi word, or null where Hindi has none
 *     term  the vocabulary code (`kinship-hi.js`: 'DADI', 'MAMA'...), or null
 *     word  what a caption prints: `hi ?? en` when `options.words === 'hi'`, else `en`
 *     through  null, or where `en` is null because the relation runs through one marriage:
 *           { kind: 'married-to', term, id }  married to F's `term` (person `id`)
 *           { kind: 'of-spouse', term, id }   the `term` of F's spouse `id`
 *           - the desktop's `sentenceFor` shapes, so copy.js says "married to Ankit's first
 *           cousin once removed", never "Ankit's first cousin once removed's wife"
 *
 * ## Where the words come from
 *
 *   - One step from F (parents, spouses, children, siblings): the app's own label rules in
 *     `model.js` - `parentLabel`, `spouseLabel`, `childLabel`, `siblingLabel` - which know the
 *     edge's subtype (step, former, late, half) that a bare kinship term cannot. No relate() call.
 *   - Everyone else: `relate(graph, F, id)` - its `term` is `kinshipLabel(termFor(u, d))` for
 *     blood relatives and the app's in-law words for the rest - and the Hindi from `hindiTerm` +
 *     `hindiWord`, exactly as the desktop's relation panel does.
 *   - Parents' Hindi words are पिताजी / माँ, the approved book wording (docs/storybook-plan.md),
 *     not the vocabulary's पिता / माता; a step-parent keeps सौतेला पिता / सौतेली माता.
 *   - A former spouse and a partner get no Hindi word: पत्नी/पति would state a marriage that
 *     ended, or one the record never called one. The English word stands in.
 *   - F themselves, and anyone in 'elsewhere', have no kin word (all fields null).
 *
 * ## Performance
 *
 * `relate()` (`../../playground/model.js`) runs two ancestor walks and a whole-graph BFS per call.
 * `kinOf` never calls it; `words(id)` calls it at most once per person, memoised for the life of
 * this result, and only when asked. Call `kinOf` once per book and `words` only for the people a
 * page actually shows. Nothing here calls `ageOf` - a partition has no reason to read the clock.
 */

import { relate, branchFrom, parentLabel, spouseLabel, childLabel, siblingLabel } from '../../playground/model.js';
import { hindiTerm } from '../../playground/kinship-hindi.js';
import { hindiWord } from '../../playground/kinship-hi.js';
import { sortKey, byKey } from '../family.js';

/** The circles, in claim order: an earlier circle's claim always beats a later one's. */
export const CIRCLES = Object.freeze([
  'self', 'parents', 'spouses', 'children', 'siblings', 'grandparents',
  'descendants', 'ancestors', 'branches', 'in-laws', 'lane', 'elsewhere',
]);

/** Every role a circle's entries can carry. */
export const ROLES = Object.freeze({
  self: ['self'],
  parents: ['parent'],
  spouses: ['current', 'former', 'late'],
  children: ['child'],
  siblings: ['full', 'half', 'explicit'],
  grandparents: ['grandparent'],
  descendants: ['grandchild', 'descendant'],
  ancestors: ['ancestor'],
  branches: ['aunt-uncle', 'aunt-uncle-spouse', 'cousin', 'cousin-descendant', 'cousin-spouse'],
  'in-laws': ['spouse-parent', 'spouse-sibling', 'sibling-spouse', 'child-spouse', 'parent-spouse', 'spouse-child'],
  lane: ['relative'],
  elsewhere: ['unlinked'],
});

const SIDE_RANK = { paternal: 0, maternal: 1, none: 2 };
const sideOf = (person) => (person?.gender === 'MALE' ? 'paternal' : person?.gender === 'FEMALE' ? 'maternal' : 'none');

/**
 * Current, former or late, by the app's own rule (`spouseLabel`): DIVORCED is former, and WIDOWED
 * is late only for the partner who actually died - the edge is symmetric and cannot say which.
 */
export function spouseStatus(spouse, subtype) {
  if (subtype === 'DIVORCED') return 'former';
  if (subtype === 'WIDOWED' && spouse?.deceased) return 'late';
  return 'current';
}

const NO_WORDS = Object.freeze({ en: null, hi: null, term: null, word: null, through: null });

/** Sorts a neighbour list by id, in place: graph.parents/children/spouses/siblings return fresh arrays. */
const byId = (list) => list.sort((a, b) => byKey(a.id, b.id));

/**
 * @param family     `readFamily(doc, options, allowance)`'s result: scope and the allowance are
 *                   already applied to `family.graph`, so only people in scope are partitioned
 * @param featuredId `resolveFeatured`'s answer; null (or an id not in scope) puts everyone in
 *                   'elsewhere'
 * @param options    { words: 'en' | 'hi', relate? } - `relate` replaces model.js's relate(), for
 *                   tests that count its calls; nothing else should pass it
 */
export function kinOf(family, featuredId, options = {}) {
  const graph = family.graph;
  const relateFn = options.relate ?? relate;
  const lang = options.words === 'hi' ? 'hi' : 'en';
  const F = featuredId != null && graph.people.has(featuredId) ? featuredId : null;

  const entries = new Map();
  const claimed = [];         // claim order, which the lane walk starts from

  const claim = (id, circle, role, fields) => {
    if (entries.has(id) || !graph.people.has(id)) return false;
    entries.set(id, { id, circle, role, side: 'none', gen: null, branch: null, via: null, ...fields });
    claimed.push(id);
    return true;
  };
  const person = (id) => graph.people.get(id);
  const familyKey = (id) => graph.familyOfChild.get(id)?.key ?? null;
  const gen = (id) => entries.get(id).gen;
  // Breadth-first from `start`: `next(x)` claims x's neighbours and returns the ones to walk on from.
  const walk = (start, next) => {
    const queue = [...start];
    for (let i = 0; i < queue.length; i++) for (const n of next(queue[i])) queue.push(n.id);
  };

  if (F !== null) {
    claim(F, 'self', 'self', { gen: 0 });

    // One link from F. The edge (its subtype, and whether a sibling is half) rides on the entry
    // until it is frozen, for the words; it is not part of the published shape.
    const oneStep = (list, circle, roleOf, fieldsOf, edgeOf) => list.filter((n) =>
      claim(n.id, circle, roleOf(n), { ...fieldsOf(n), via: F, edge: edgeOf(n) }));

    // Paternal first, then maternal, then a parent whose gender is not recorded: where both sides
    // reach the same grandparent (cousins who married), the father's side claims them.
    const parentIds = oneStep(
      byId(graph.parents(F)).sort((a, b) => SIDE_RANK[sideOf(person(a.id))] - SIDE_RANK[sideOf(person(b.id))]),
      'parents', () => 'parent', (p) => ({ side: sideOf(person(p.id)), gen: -1 }), (p) => ({ subtype: p.subtype }),
    ).map((p) => p.id);
    const spouseIds = oneStep(byId(graph.spouses(F)), 'spouses', (s) => spouseStatus(person(s.id), s.subtype),
      () => ({ gen: 0 }), (s) => ({ subtype: s.subtype })).map((s) => s.id);
    const childIds = oneStep(byId(graph.children(F)), 'children', () => 'child',
      (c) => ({ gen: 1, branch: familyKey(c.id) }), (c) => ({ subtype: c.subtype })).map((c) => c.id);
    const siblingIds = oneStep(byId(graph.siblings(F)), 'siblings', (s) => (!s.derived ? 'explicit' : s.half ? 'half' : 'full'),
      (s) => ({ gen: 0, branch: s.derived ? familyKey(s.id) : null }), (s) => ({ half: s.half })).map((s) => s.id);
    // Explicit sibling links are transitive, as model.js's stand-in parents read them: three
    // siblings recorded as two links are one family, so F's full brother's explicit sister is F's
    // sister. Only through a full sibling, though: a half-sibling's explicit sister may belong to
    // the parent F does not share, so the walk neither starts from nor continues past anyone half.
    walk([F, ...siblingIds.filter((id) => !entries.get(id).edge.half)], (x) => byId([...(graph.explicitSiblings.get(x)?.values() ?? [])]).filter((s) => {
      const half = s.subtype === 'HALF';
      if (!claim(s.id, 'siblings', 'explicit', { gen: 0, via: x, edge: { half } })) return false;
      siblingIds.push(s.id);
      return !half;
    }));

    // Everyone one link from `anchors`, kept on the anchor's side and grouped under it.
    const hang = (anchors, neighbours, circle, role, delta) => {
      const out = [];
      for (const a of anchors) {
        const { side } = entries.get(a);
        for (const n of byId(neighbours(a))) if (claim(n.id, circle, role, { side, gen: gen(a) + delta, branch: a, via: a })) out.push(n.id);
      }
      return out;
    };
    const grandparentIds = hang(parentIds, graph.parents, 'grandparents', 'grandparent', -1);

    // Down from F's children, one generation at a time, through nobody another circle has claimed.
    walk(childIds, (x) => {
      const below = gen(x) + 1;
      const branch = below === 2 ? x : entries.get(x).branch;
      const role = below === 2 ? 'grandchild' : 'descendant';
      return byId(graph.children(x)).filter((c) => claim(c.id, 'descendants', role, { gen: below, branch, via: x }));
    });

    // Up from the grandparents, keeping the side and the parent the line started from.
    walk(grandparentIds, (x) => {
      const { side, branch } = entries.get(x);
      return byId(graph.parents(x)).filter((a) => claim(a.id, 'ancestors', 'ancestor', { side, gen: gen(x) - 1, branch, via: x }));
    });

    // One branch per aunt or uncle: exactly `branchFrom`'s family of them (model.js) - everyone
    // below them, and whoever each of those married - less anyone a nearer circle already holds.
    // The walk goes on through such a person, so their children still join the branch, as they do
    // in the app's branch view; it only adds each person's generation and who reached them.
    for (const p of parentIds) {
      const side = entries.get(p).side;
      for (const s of byId(graph.siblings(p))) {
        if (!claim(s.id, 'branches', 'aunt-uncle', { side, gen: -1, branch: s.id, via: p })) continue;
        const members = branchFrom(graph, s.id);
        const depth = new Map([[s.id, -1]]);
        walk([s.id], (x) => {
          const married = x === s.id ? 'aunt-uncle-spouse' : 'cousin-spouse';
          for (const m of byId(graph.spouses(x))) if (members.has(m.id)) claim(m.id, 'branches', married, { side, gen: depth.get(x), branch: s.id, via: x });
          const below = depth.get(x) + 1;
          const role = below === 0 ? 'cousin' : 'cousin-descendant';
          return byId(graph.children(x)).filter((c) => {
            if (depth.has(c.id)) return false;
            depth.set(c.id, below);
            claim(c.id, 'branches', role, { side, gen: below, branch: s.id, via: x });
            return true;
          });
        });
      }
    }

    // One marriage away from the core.
    const inLaw = (anchors, neighbours, role, delta) => hang(anchors, neighbours, 'in-laws', role, delta);
    inLaw(spouseIds, graph.parents, 'spouse-parent', -1);
    inLaw(spouseIds, graph.siblings, 'spouse-sibling', 0);
    inLaw(siblingIds, graph.spouses, 'sibling-spouse', 0);
    inLaw(childIds, graph.spouses, 'child-spouse', 0);
    inLaw(parentIds, graph.spouses, 'parent-spouse', 0);
    inLaw(spouseIds, graph.children, 'spouse-child', 1);

    // Everyone else joined to F, breadth-first from the people already placed, in claim order:
    // blood before marriage, as `shortestPath` walks, so a nephew is reached through his parent
    // rather than through whoever he married.
    for (let i = 0; i < claimed.length; i++) {
      const x = claimed[i];
      const from = entries.get(x);
      const branch = from.circle === 'lane' ? from.branch : x;
      const reach = (list, delta) => {
        for (const n of byId(list)) claim(n.id, 'lane', 'relative', { side: from.side, gen: from.gen === null ? null : from.gen + delta, branch, via: x });
      };
      reach(graph.parents(x), -1);
      reach(graph.children(x), 1);
      reach([...(graph.explicitSiblings.get(x)?.values() ?? [])], 0);
      reach(graph.spouses(x), 0);
    }
  }

  for (const id of [...graph.people.keys()].sort(byKey)) claim(id, 'elsewhere', 'unlinked', {});

  for (const e of entries.values()) e.namedBy = person(e.id).name ? null : namedBy(graph, e.id);

  // Circle order: see the header. Each person's sort tuple is worked out once.
  const tuples = new Map();
  for (const id of claimed) {
    const name = person(id).name;
    tuples.set(id, [family.byId.get(id)?.by ?? null, name ? sortKey(name) : null, id]);
  }
  const cmpTuple = (a, b) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      if (a[i] === null) return 1;
      if (b[i] === null) return -1;
      return typeof a[i] === 'number' ? a[i] - b[i] : byKey(a[i], b[i]);
    }
    return 0;
  };
  const buckets = Object.fromEntries(CIRCLES.map((c) => [c, []]));
  for (const id of claimed) buckets[entries.get(id).circle].push(id);
  const bkey = (id) => entries.get(id).branch ?? '';
  const circles = {};
  const people = new Map();
  const edges = new Map();   // id -> the one-step edge, for the words
  for (const circle of CIRCLES) {
    const ids = buckets[circle];
    const eldest = new Map();   // branch -> its eldest member's tuple, which orders the branches
    for (const id of ids) {
      const t = tuples.get(id);
      if (!eldest.has(bkey(id)) || cmpTuple(t, eldest.get(bkey(id))) < 0) eldest.set(bkey(id), t);
    }
    ids.sort((a, b) => {
      const ea = entries.get(a), eb = entries.get(b);
      return SIDE_RANK[ea.side] - SIDE_RANK[eb.side]
        || cmpTuple(eldest.get(bkey(a)), eldest.get(bkey(b)))
        || byKey(bkey(a), bkey(b))
        || (ea.gen ?? Infinity) - (eb.gen ?? Infinity)
        || cmpTuple(tuples.get(a), tuples.get(b));
    });
    circles[circle] = Object.freeze(ids);
    for (const id of ids) {
      const { edge, ...entry } = entries.get(id);
      if (edge) edges.set(id, edge);
      people.set(id, Object.freeze(entry));
    }
  }

  return Object.freeze({
    featured: F, people, circles: Object.freeze(circles),
    words: wordsOf({ graph, F, edges, people, lang, relateFn }),
  });
}

/**
 * `words(id)`, memoised. Built outside `kinOf` so the returned object holds only what it needs,
 * not the partition's working maps.
 */
function wordsOf({ graph, F, edges, people, lang, relateFn }) {
  const cache = new Map();
  const wordsFor = (entry) => {
    if (entry.circle === 'self' || entry.circle === 'elsewhere') return NO_WORDS;
    const to = graph.people.get(entry.id);
    const edge = edges.get(entry.id);
    let en, term, hi = null, through = null;
    if (edge) {
      ({ en, term, hi } = directWords(entry.circle, edge, to));
    } else {
      const r = relateFn(graph, F, entry.id);
      en = r?.term ?? null;
      // No possessive chain ("first cousin once removed's wife"): like the desktop's relation panel
      // (`sentenceFor`), the caption has no word, and copy.js turns the facts round instead -
      // "married to Ankit's first cousin", "the mother of Ankit's wife".
      if (!en && r?.marriedTo) through = Object.freeze({ kind: 'married-to', term: r.marriedTo.term, id: r.marriedTo.person.id });
      if (!en && r?.ofSpouse) through = Object.freeze({ kind: 'of-spouse', term: r.ofSpouse.term, id: r.ofSpouse.spouse.id });
      term = hindiTerm(r?.kinship, graph.people.get(F).gender ?? 'UNSPECIFIED', to.gender ?? 'UNSPECIFIED');
    }
    if (hi === null) hi = hindiWord(term)?.word ?? null;
    return Object.freeze({ en, hi, term: term ?? null, word: lang === 'hi' ? (hi ?? en) : en, through });
  };
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const entry = people.get(id);
    const result = entry ? wordsFor(entry) : null;
    cache.set(id, result);
    return result;
  };
}

/** The words for somebody one link from F, from the app's own label rules. */
function directWords(circle, step, to) {
  const g = to.gender;
  const pick = (male, female) => (g === 'MALE' ? male : g === 'FEMALE' ? female : null);
  switch (circle) {
    case 'parents': {
      const en = parentLabel(to, step.subtype).toLowerCase();
      if (step.subtype === 'STEP') return { en, term: pick('SAUTELA_PITA', 'SAUTELI_MATA'), hi: null };
      // The approved book words, not the vocabulary's पिता / माता (storybook-plan.md, Decisions).
      return { en, term: pick('PITA', 'MATA'), hi: pick('पिताजी', 'माँ') };
    }
    case 'spouses': {
      const en = spouseLabel(to, step.subtype).toLowerCase();
      const married = spouseStatus(to, step.subtype) !== 'former' && step.subtype !== 'PARTNER';
      return { en, term: married ? pick('PATI', 'PATNI') : null, hi: null };
    }
    case 'children':
      return {
        en: childLabel(to, step.subtype).toLowerCase(),
        term: step.subtype === 'STEP' ? pick('SAUTELA_BETA', 'SAUTELI_BETI') : pick('BETA', 'BETI'),
        hi: null,
      };
    default:
      return { en: siblingLabel(to, step.half).toLowerCase(), term: pick('BHAI', 'BEHEN'), hi: null };
  }
}

/**
 * The named relative somebody with no recorded name is called after: "Shyam Lal's wife", never
 * "Unknown" (storybook-plan.md, belief 3). A spouse first - it is how a family names a woman whose
 * own name was lost - then a child ("Ramesh's mother"), a parent ("Sita's daughter"), a sibling.
 * Ties go to the lowest id. Only direct links, so this costs nothing like relate().
 */
function namedBy(graph, id) {
  const me = graph.people.get(id);
  const candidates = [
    [() => graph.spouses(id), (n) => spouseLabel(me, n.subtype)],
    [() => graph.children(id), (n) => parentLabel(me, n.subtype)],
    [() => graph.parents(id), (n) => childLabel(me, n.subtype)],
    [() => graph.siblings(id), (n) => siblingLabel(me, n.half)],
  ];
  for (const [list, label] of candidates) {
    let best = null;
    for (const n of list()) if (graph.people.get(n.id)?.name && (!best || byKey(n.id, best.id) < 0)) best = n;
    if (best) return { id: best.id, word: label(best).toLowerCase() };
  }
  return null;
}
