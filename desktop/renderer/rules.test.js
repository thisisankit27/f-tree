/*
 * RelationshipRulesTest.kt, case for case.
 *
 * These are not new tests. Every one is a translation of a case in
 * `app/src/test/java/com/vibethroughcode/ftree/graph/RelationshipRulesTest.kt`, kept in the same
 * order and with the same names, because the point of the exercise is that two implementations of
 * one set of rules must not drift apart. Reading the two files side by side should be dull.
 *
 * Where a case is added rather than translated it says so.
 */

import test from 'node:test';
import assert from 'node:assert';

import {
  RelationshipType, Rejection, checkRelationship, isSymmetric, relationshipTypeFrom,
} from './rules.js';

const { PARENT, SPOUSE, SIBLING, UNKNOWN } = RelationshipType;

/** The Kotlin's `rules()` helper: a fake graph of existing edges and known parents. */
function rules({ existing = [], parents = {} } = {}) {
  const edges = new Set(existing.map(([from, to, type]) => `${from} ${to} ${type}`));
  return (from, to, type) => checkRelationship({
    from,
    to,
    type,
    existingEdgeExists: (f, t, ty) => edges.has(`${f} ${t} ${ty}`),
    parentsOf: (id) => parents[id] ?? [],
  });
}

const assertRejected = (reason, actual) =>
  assert.deepStrictEqual(actual, { allowed: false, reason });
const assertAllowed = (actual) => assert.deepStrictEqual(actual, { allowed: true });

test('a person cannot be their own parent spouse or sibling', () => {
  const check = rules();
  for (const type of [PARENT, SPOUSE, SIBLING, UNKNOWN]) {
    assertRejected(Rejection.SELF_REFERENCE, check('me', 'me', type));
  }
});

test('an identical edge is a duplicate', () => {
  const check = rules({ existing: [['father', 'me', PARENT]] });
  assertRejected(Rejection.DUPLICATE, check('father', 'me', PARENT));
});

test('a symmetric edge is a duplicate from either side', () => {
  const check = rules({ existing: [['a', 'b', SPOUSE]] });
  assertRejected(Rejection.DUPLICATE, check('b', 'a', SPOUSE));
});

test('a parent edge is directional so the reverse is not a duplicate', () => {
  // The existing father-to-me edge must not block me-to-father being *checked*; it is instead
  // rejected as a cycle, which is the accurate reason.
  const check = rules({
    existing: [['father', 'me', PARENT]],
    parents: { me: ['father'] },
  });
  assertRejected(Rejection.ANCESTOR_CYCLE, check('me', 'father', PARENT));
});

test('a parent cannot also be a spouse or sibling of their child', () => {
  const check = rules({ existing: [['father', 'me', PARENT]] });
  assertRejected(Rejection.CONTRADICTS_EXISTING, check('father', 'me', SPOUSE));
  assertRejected(Rejection.CONTRADICTS_EXISTING, check('me', 'father', SIBLING));
});

test('an edge that would make someone their own ancestor is rejected', () => {
  const check = rules({ parents: { me: ['father'], father: ['grandfather'] } });
  assertRejected(Rejection.ANCESTOR_CYCLE, check('me', 'grandfather', PARENT));
});

test('ordinary relationships are allowed', () => {
  const check = rules({ parents: { me: ['father'] } });
  assertAllowed(check('mother', 'me', PARENT));
  assertAllowed(check('me', 'wife', SPOUSE));
  assertAllowed(check('me', 'child', PARENT));
  assertAllowed(check('me', 'brother', SIBLING));
});

/* ---------------------------------------------------------------- beyond the Kotlin's table */

/*
 * Added here, not translated. The Kotlin reaches its graph through a database that cannot return
 * a cycle it did not already contain; this port is handed whatever an imported file said, and a
 * file can say anything. These pin the behaviour that keeps a bad import from hanging the app.
 */

test('a cycle already in the data does not hang the check', () => {
  // Each is recorded as the other's parent: nonsense, and importable.
  const check = rules({ parents: { a: ['b'], b: ['a'] } });
  assertRejected(Rejection.ANCESTOR_CYCLE, check('a', 'b', PARENT));
  assertAllowed(check('c', 'd', PARENT));
});

test('a long line is walked without recursion', () => {
  const parents = {};
  for (let i = 1; i < 5000; i += 1) parents[`p${i}`] = [`p${i + 1}`];
  const check = rules({ parents });
  assertRejected(Rejection.ANCESTOR_CYCLE, check('p1', 'p5000', PARENT));
  assertAllowed(check('p1', 'stranger', PARENT));
});

test('an unrecognised type becomes UNKNOWN rather than being dropped', () => {
  assert.strictEqual(relationshipTypeFrom('PARENT'), PARENT);
  assert.strictEqual(relationshipTypeFrom('MARRIED_TO'), UNKNOWN);
  assert.strictEqual(relationshipTypeFrom(undefined), UNKNOWN);
  // Guards against a prototype key being mistaken for a type.
  assert.strictEqual(relationshipTypeFrom('toString'), UNKNOWN);
});

test('only spouse and sibling are symmetric', () => {
  assert.ok(isSymmetric(SPOUSE) && isSymmetric(SIBLING));
  assert.ok(!isSymmetric(PARENT) && !isSymmetric(UNKNOWN));
});
