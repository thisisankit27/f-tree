/*
 * CompactFamilyTest.kt, case for case, plus the selection half of TreeLayoutEngineTest.kt.
 *
 * These are not new tests. Almost every one is a translation of a case in
 * `app/src/test/java/com/vibethroughcode/ftree/graph/CompactFamilyTest.kt` or
 * `TreeLayoutEngineTest.kt`, kept in the same order and with the same names, because the point of
 * the exercise is that two implementations of one set of family rules must not drift apart.
 * Reading the two files side by side should be dull.
 *
 * Where a case is added rather than translated it says so.
 *
 * The Kotlin builds a `TreeLayout` and reads levels back off it. Here `collectFocused` returns the
 * levels directly, so the cases that assert `layout.node("g2") == null` become assertions about
 * `levels.has('g2')` -- the same claim about the same rule, without a coordinate in sight.
 */

import test from 'node:test';
import assert from 'node:assert';

import { buildGraph } from './model.js';
import { collectFocused, mostConnected } from './focus.js';
import { compactFamily } from './compact.js';

/** Builds a graph from a compact description of a family, as the Kotlin's Builder does. */
class Builder {
  constructor() {
    this.people = [];
    this.relationships = [];
  }

  person(id, born = null) {
    this.people.push({ id, name: id, birthDate: born });
    return this;
  }

  unnamed(id) {
    this.people.push({ id, name: null });
    return this;
  }

  parentOf(parent, child) {
    this.relationships.push({ from: parent, to: child, type: 'PARENT' });
    return this;
  }

  married(a, b) {
    this.relationships.push({ from: a, to: b, type: 'SPOUSE' });
    return this;
  }

  siblingOf(a, b) {
    this.relationships.push({ from: a, to: b, type: 'SIBLING' });
    return this;
  }

  build() {
    return buildGraph({ people: this.people, relationships: this.relationships });
  }
}

const compact = (graph, focusId, { up = 3, down = 3 } = {}) =>
  compactFamily(graph, focusId, { up, down });

/** Three generations, a second marriage upstairs, and a sibling with a spouse of their own. */
const family = () => new Builder()
  .person('grandfather', '1935').person('grandmother', '1938')
  .person('stepGrandmother', '1944')
  .person('father', '1962').person('mother', '1965')
  .person('me', '1990').person('sister', '1987').person('wife', '1992')
  .person('brotherInLaw', '1985')
  .person('son', '2018').person('daughter', '2020')
  .married('grandfather', 'grandmother')
  .married('grandfather', 'stepGrandmother')
  .married('father', 'mother')
  .married('me', 'wife')
  .married('sister', 'brotherInLaw')
  .parentOf('grandfather', 'father').parentOf('grandmother', 'father')
  .parentOf('father', 'me').parentOf('mother', 'me')
  .parentOf('father', 'sister').parentOf('mother', 'sister')
  .parentOf('me', 'son').parentOf('wife', 'son')
  .parentOf('me', 'daughter').parentOf('wife', 'daughter')
  .build();

/** Everybody on a row, in the order they are read across it. */
const ids = (view, offset) =>
  (view.band(offset)?.groups ?? []).flatMap((group) => group.ids);

/** Only the people the row's heading counts. */
const counted = (view, offset) =>
  (view.band(offset)?.groups ?? [])
    .flatMap((group) => group.ids.filter((id) => group.ofBand.has(id)));

// ------------------------------------------------------------------ CompactFamilyTest.kt

test('an unknown focus produces nothing rather than throwing', () => {
  assert.ok(compact(family(), 'nobody').isEmpty);
});

test('generations become bands measured from the focus', () => {
  const view = compact(family(), 'me');

  assert.strictEqual(view.focus.person.id, 'me');
  assert.deepStrictEqual(counted(view, -2), ['grandmother', 'grandfather']);
  assert.deepStrictEqual(counted(view, -1), ['father', 'mother']);
  assert.deepStrictEqual(counted(view, 0), ['sister']);
  assert.deepStrictEqual(counted(view, 1), ['son', 'daughter']);
});

test('the focus is shown with whoever they married rather than beside them', () => {
  const view = compact(family(), 'me');

  assert.deepStrictEqual(view.focus.partners.map((p) => p.id), ['wife']);
  // The wife is on row zero too, but she belongs to the centre, not to the row of siblings.
  assert.ok(!ids(view, 0).includes('wife'));
});

test('somebody married into a generation is shown there but not counted as one of it', () => {
  const view = compact(family(), 'me');

  // Both parents are parents; the heading counts two.
  assert.strictEqual(view.band(-1).count, 2);

  // A second marriage upstairs shows the step-grandmother without making her a grandparent.
  assert.strictEqual(view.band(-2).count, 2);
  assert.deepStrictEqual(ids(view, -2), ['grandmother', 'grandfather', 'stepGrandmother']);
});

test('a second marriage puts the twice-married person between their two spouses', () => {
  const groups = compact(family(), 'me').band(-2).groups;
  assert.strictEqual(groups.length, 1);
  const group = groups[0];

  assert.deepStrictEqual(group.ids, ['grandmother', 'grandfather', 'stepGrandmother']);
  // Every mark drawn is a marriage that happened: the two wives were never wed.
  assert.ok(group.married(0));
  assert.ok(group.married(1));
  assert.strictEqual(group.links.length, 2);
});

test('two people who never married stand apart rather than joined', () => {
  const graph = new Builder()
    .person('me', '1990')
    .person('son', '2015').person('daughter', '2018')
    .parentOf('me', 'son').parentOf('me', 'daughter')
    .build();

  const children = compact(graph, 'me').band(1);
  assert.strictEqual(children.groups.length, 2);
  assert.ok(children.groups.every((g) => g.links.length === 0));
});

test('a row of brothers and sisters leads with the sibling, not the person she married', () => {
  const siblings = compact(family(), 'me').band(0);

  assert.strictEqual(siblings.count, 1);
  assert.strictEqual(siblings.groups.length, 1);
  assert.deepStrictEqual(siblings.groups[0].ids, ['sister', 'brotherInLaw']);
  assert.ok(siblings.groups[0].married(0));
});

test('a band is read oldest first, with undated people last', () => {
  const graph = new Builder()
    .person('me', '1990')
    .person('father', '1960')
    .person('youngest', '2015').person('eldest', '2005').unnamed('undated')
    .parentOf('father', 'me')
    .parentOf('me', 'youngest').parentOf('me', 'eldest').parentOf('me', 'undated')
    .build();

  assert.deepStrictEqual(ids(compact(graph, 'me'), 1), ['eldest', 'youngest', 'undated']);
});

test('an empty generation is left out rather than shown as an empty band', () => {
  const view = compact(new Builder().person('me', '1990').build(), 'me');

  assert.strictEqual(view.focus.person.id, 'me');
  assert.deepStrictEqual(view.bands, []);
  assert.strictEqual(view.band(-1), null);
  assert.strictEqual(view.band(1), null);
});

test("siblings joined only by an explicit edge still share the focus's row", () => {
  const graph = new Builder()
    .person('me', '1990').person('cousinless', '1992')
    .siblingOf('me', 'cousinless')
    .build();

  assert.deepStrictEqual(ids(compact(graph, 'me'), 0), ['cousinless']);
});

test('it shows exactly the people the selection chose', () => {
  const graph = family();
  for (const focusId of ['me', 'father', 'grandfather', 'sister', 'son']) {
    const selection = collectFocused(graph, focusId);
    const view = compactFamily(graph, focusId, { selection });

    assert.deepStrictEqual(
      new Set(view.everyone),
      new Set(selection.levels.keys()),
      `centred on ${focusId}`,
    );
    // Nobody is shown twice: a partner belongs to one person, and the centre is not also standing
    // in its own row.
    assert.strictEqual(
      view.everyone.length,
      new Set(view.everyone).size,
      `centred on ${focusId}`,
    );
  }
});

test('it says when the record continues past what was loaded', () => {
  const graph = family();

  assert.ok(compact(graph, 'me', { up: 1 }).truncated);
  assert.ok(!compact(graph, 'me', { up: 3 }).truncated);
});

// ------------------------------------------------- TreeLayoutEngineTest.kt, the selection half

const nuclearFamily = () => new Builder()
  .person('father', '1962').person('mother', '1965')
  .person('me', '1990').person('sister', '1993')
  .person('wife', '1992').person('child', '2020')
  .married('father', 'mother')
  .married('me', 'wife')
  .parentOf('father', 'me').parentOf('mother', 'me')
  .parentOf('father', 'sister').parentOf('mother', 'sister')
  .parentOf('me', 'child').parentOf('wife', 'child')
  .build();

test('an unknown focus selects nothing rather than throwing', () => {
  const selection = collectFocused(nuclearFamily(), 'nobody');
  assert.strictEqual(selection.focusId, null);
  assert.strictEqual(selection.levels.size, 0);
});

test('a lone person is a chart of one', () => {
  const selection = collectFocused(new Builder().person('me').build(), 'me');

  assert.strictEqual(selection.levels.size, 1);
  assert.strictEqual(selection.levels.get('me'), 0);
});

test('generations sit at their own offsets before and after the focus', () => {
  const levels = collectFocused(nuclearFamily(), 'me').levels;

  assert.strictEqual(levels.get('father'), -1);
  assert.strictEqual(levels.get('mother'), -1);
  assert.strictEqual(levels.get('me'), 0);
  assert.strictEqual(levels.get('sister'), 0);
  assert.strictEqual(levels.get('wife'), 0);
  assert.strictEqual(levels.get('child'), 1);
});

test('siblings joined only by an explicit edge still share the generation', () => {
  const graph = new Builder()
    .person('me', '1990').person('brother', '1992')
    .siblingOf('me', 'brother')
    .build();

  assert.strictEqual(collectFocused(graph, 'me').levels.get('brother'), 0);
});

test('the generation limit bounds how far the chart reaches', () => {
  const builder = new Builder();
  // A ten-generation line of descent.
  for (let i = 0; i <= 10; i++) builder.person(`g${i}`, String(1900 + i * 25));
  for (let i = 0; i < 10; i++) builder.parentOf(`g${i}`, `g${i + 1}`);

  const levels = collectFocused(builder.build(), 'g5', { up: 2, down: 2 }).levels;

  assert.ok(levels.has('g3'));
  assert.ok(levels.has('g7'));
  assert.ok(!levels.has('g2'));
  assert.ok(!levels.has('g8'));
  assert.ok(
    collectFocused(builder.build(), 'g5', { up: 2, down: 2 }).truncated,
    'more generations exist, so the chart says so',
  );
});

test('a fully shown family is not marked truncated', () => {
  assert.ok(!collectFocused(nuclearFamily(), 'me').truncated);
});

test('cousins are left out because re-focusing reaches them', () => {
  const graph = new Builder()
    .person('grandfather').person('father').person('uncle')
    .person('me').person('cousin')
    .parentOf('grandfather', 'father').parentOf('grandfather', 'uncle')
    .parentOf('father', 'me').parentOf('uncle', 'cousin')
    .build();

  const levels = collectFocused(graph, 'me').levels;

  assert.ok(levels.has('grandfather'));
  assert.ok(levels.has('father'));
  // The uncle's line would multiply the width without adding to what the chart says.
  assert.ok(!levels.has('cousin'));
  // Added, not translated, and worth pinning because it surprised me: the *uncle himself* is out
  // too. The upward walk adds parents and their partners -- never siblings, except on the focus's
  // own row. So "not the descendants of ancestors' siblings" is really "not ancestors' siblings at
  // all", and an uncle is reached by re-focusing on the grandfather rather than from here.
  assert.ok(!levels.has('uncle'));
});

test('the same family always selects the same way', () => {
  const graph = family();
  const once = compactFamily(graph, 'me');
  const twice = compactFamily(graph, 'me');

  assert.deepStrictEqual(once.everyone, twice.everyone);
  for (const offset of [-2, -1, 0, 1]) {
    assert.deepStrictEqual(ids(once, offset), ids(twice, offset));
  }
});

// ------------------------------------------------------------------ added, not translated

test("nieces and nephews are left out, which is the same rule from the other direction", () => {
  // The Kotlin tests cousins; it does not test the downward half of the same exclusion, and the
  // downward walk starts from the focus alone precisely to produce it.
  const graph = new Builder()
    .person('me').person('sister').person('niece')
    .person('mother')
    .parentOf('mother', 'me').parentOf('mother', 'sister')
    .parentOf('sister', 'niece')
    .build();

  const levels = collectFocused(graph, 'me').levels;

  assert.ok(levels.has('sister'));
  assert.ok(!levels.has('niece'));
});

test('a cousin marriage gets one stable level rather than two', () => {
  // The reason every assignment is `putIfAbsent`. Reachable as both a spouse on row 0 and a child
  // on row 1, this person must land on one row and stay there.
  const graph = new Builder()
    .person('me', '1990').person('cousinWife', '1991')
    .person('father', '1960').person('uncle', '1958')
    .married('me', 'cousinWife')
    .parentOf('father', 'me').parentOf('uncle', 'cousinWife')
    .build();

  const levels = collectFocused(graph, 'me').levels;
  assert.strictEqual(levels.get('cousinWife'), 0);
});

test('the most-connected person is the fallback focus, and it is stable', () => {
  // Not in the Kotlin: the phone always arrives at this view holding a person. The desktop can
  // open a file with nobody selected, and "the first row of the file" is export order.
  const graph = family();
  assert.strictEqual(mostConnected(graph), mostConnected(graph));
  // `me` has two parents, two children, a wife and a sister: nobody in this family has more.
  assert.strictEqual(mostConnected(graph), 'me');
});

test('an empty tree has no focus to fall back to', () => {
  assert.strictEqual(mostConnected(buildGraph({ people: [], relationships: [] })), null);
  assert.ok(compactFamily(buildGraph({ people: [], relationships: [] }), null).isEmpty);
});

test('somebody married three times is walked in the Kotlin’s order, not the obvious one', () => {
  /*
   * Added, not translated -- and it exists because the first version of `readAcross` got this
   * wrong in a way no other case could see.
   *
   * The Kotlin pushes each sorted neighbour with `ArrayDeque.addFirst`, in a `forEach`. Pushing a,
   * then b, then c to the *front* leaves the queue as c, b, a -- so the walk continues with the
   * LAST of the sorted neighbours, not the first. Translating that as "unshift them in reverse"
   * reads more natural and is the opposite order.
   *
   * It can only show where one person has two or more unwalked spouses inside the group, which
   * means somebody married at least three times. Every other case in this file has a group whose
   * members each have one unwalked neighbour, and passes under either order.
   */
  const graph = new Builder()
    .person('me', '1990')
    .person('thrice', '1960')
    .person('first', '1958').person('second', '1962').person('third', '1966')
    .married('thrice', 'first').married('thrice', 'second').married('thrice', 'third')
    .parentOf('thrice', 'me')
    .build();

  const group = compact(graph, 'me').band(-1).groups[0];

  // `thrice` is the only person with more than one marriage, so the chain starts at an end and
  // reaches them second. What follows is the part the order decides.
  assert.deepStrictEqual(group.ids, ['first', 'thrice', 'third', 'second']);

  // Every mark is a real marriage: the three spouses were never wed to each other, so only the
  // gaps that touch `thrice` are marked.
  assert.deepStrictEqual(group.links, [true, true, false]);
});
