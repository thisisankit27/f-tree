/*
 * The shared-ancestor search, after being written once instead of twice.
 *
 * `relate` and `bloodTerm` each carried their own copy of the same loop -- the same walk up, the
 * same scoring, the same tie-break, character for character. Two copies of a tie-break rule is one
 * copy waiting to be changed alone, and the one inside `bloodTerm` is the one that names in-laws,
 * so a divergence there would be visible only on affinal relationships and nowhere else.
 *
 * `kinship-golden.txt` is the real gate for this refactor: 753 lines that must not move. These
 * tests are the readable half, and they cover the two things the golden cannot -- that the memo
 * introduced here is per-graph, and that it survives being asked twice.
 */

import test from 'node:test';
import assert from 'node:assert';

import { buildGraph, relate, restrictedGraph } from './model.js';

/** Two brothers joined only by an explicit sibling edge, each with a child. */
const unrecordedParent = () => buildGraph({
  people: [
    { id: 'a', name: 'A', gender: 'MALE' },
    { id: 'b', name: 'B', gender: 'MALE' },
    { id: 'a-son', name: 'A Son', gender: 'MALE' },
    { id: 'b-son', name: 'B Son', gender: 'MALE' },
  ],
  relationships: [
    { from: 'a', to: 'b', type: 'SIBLING' },
    { from: 'a', to: 'a-son', type: 'PARENT' },
    { from: 'b', to: 'b-son', type: 'PARENT' },
  ],
});

test('a parent nobody wrote down still makes cousins of two children', () => {
  /*
   * What the stand-in is for. Without somebody to measure through, an aunt reachable only through
   * her brother comes back as merely "related" -- the gap in the record swallowing a word the
   * family uses every day.
   */
  const graph = unrecordedParent();
  assert.strictEqual(relate(graph, 'a-son', 'b-son').term, 'first cousin');
  assert.strictEqual(relate(graph, 'a', 'b').term, 'brother');
});

test('asking twice about the same graph gives the same answer', () => {
  // The memo is filled by the first call. If it were wrong to reuse, this is where it would show.
  const graph = unrecordedParent();
  const once = relate(graph, 'a-son', 'b-son');
  const twice = relate(graph, 'a-son', 'b-son');
  assert.strictEqual(once.term, twice.term);
  assert.strictEqual(once.via, twice.via);
});

test('one graph’s stand-ins do not answer for another graph', () => {
  /*
   * The risk the memo introduces, pinned. It is hung off the graph rather than kept in a module
   * cache precisely so that it lives exactly as long as the graph does -- `buildGraph` makes a new
   * one on every edit, and a cache that outlived an edit would answer about a tree that no longer
   * exists.
   *
   * Here the second graph has the *same ids* and no sibling edge at all, so a leaked stand-in would
   * make cousins of two people the file says nothing about.
   */
  const withEdge = unrecordedParent();
  assert.strictEqual(relate(withEdge, 'a-son', 'b-son').term, 'first cousin');

  const withoutEdge = buildGraph({
    people: withEdge.doc.people,
    relationships: withEdge.doc.relationships.filter((r) => r.type !== 'SIBLING'),
  });
  assert.strictEqual(relate(withoutEdge, 'a-son', 'b-son').term, null);
  assert.strictEqual(relate(withoutEdge, 'a', 'b').term, null);
});

test('a cut-down graph works out its own stand-ins', () => {
  // `restrictedGraph` goes back through `buildGraph`, so it cannot inherit a stale memo -- but the
  // relation finder draws its chart from one, so it is worth saying so out loud.
  const graph = unrecordedParent();
  relate(graph, 'a-son', 'b-son');
  const cut = restrictedGraph(graph, ['a', 'b', 'a-son', 'b-son']);
  assert.strictEqual(relate(cut, 'a-son', 'b-son').term, 'first cousin');
});

test('the nearest shared ancestor is the one measured through', () => {
  /*
   * A family that married within itself shares more than one ancestor. Measured through the far
   * one, two people who are plainly cousins come back as something nobody says.
   */
  const graph = buildGraph({
    people: [
      { id: 'old', name: 'Old', gender: 'MALE' },
      { id: 'gran', name: 'Gran', gender: 'MALE' },
      { id: 'other', name: 'Other', gender: 'MALE' },
      { id: 'p1', name: 'P1', gender: 'MALE' },
      { id: 'p2', name: 'P2', gender: 'MALE' },
      { id: 'x', name: 'X', gender: 'MALE' },
      { id: 'y', name: 'Y', gender: 'MALE' },
    ],
    relationships: [
      { from: 'old', to: 'gran', type: 'PARENT' },
      { from: 'old', to: 'other', type: 'PARENT' },
      { from: 'gran', to: 'p1', type: 'PARENT' },
      { from: 'gran', to: 'p2', type: 'PARENT' },
      { from: 'other', to: 'p2', type: 'PARENT' },
      { from: 'p1', to: 'x', type: 'PARENT' },
      { from: 'p2', to: 'y', type: 'PARENT' },
    ],
  });

  // Through `gran` they are first cousins; through `old` they would be something further out.
  assert.strictEqual(relate(graph, 'x', 'y').term, 'first cousin');
  assert.strictEqual(relate(graph, 'x', 'y').via, 'gran');
});

test('where two ancestors are equally near, the symmetric one wins', () => {
  /*
   * The second half of the tie-break, and the reason it is not just "fewest steps". Two routes of
   * the same total length can be 1-up-3-down or 2-up-2-down; the first names an uncle's line and
   * the second names cousins, and only one of those is what the family calls them.
   */
  const graph = buildGraph({
    people: [
      { id: 'top', name: 'Top', gender: 'MALE' },
      { id: 'l1', name: 'L1', gender: 'MALE' }, { id: 'l2', name: 'L2', gender: 'MALE' },
      { id: 'r1', name: 'R1', gender: 'MALE' }, { id: 'r2', name: 'R2', gender: 'MALE' },
    ],
    relationships: [
      { from: 'top', to: 'l1', type: 'PARENT' },
      { from: 'top', to: 'r1', type: 'PARENT' },
      { from: 'l1', to: 'l2', type: 'PARENT' },
      { from: 'r1', to: 'r2', type: 'PARENT' },
    ],
  });

  // 2 up, 2 down through `top`: first cousins, said the way a family says it.
  assert.strictEqual(relate(graph, 'l2', 'r2').term, 'first cousin');
});

test('two people who share nobody get no term at all', () => {
  const graph = buildGraph({
    people: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    relationships: [],
  });
  assert.strictEqual(relate(graph, 'a', 'b').term, null);
  assert.strictEqual(relate(graph, 'a', 'b').kind, 'none');
});
