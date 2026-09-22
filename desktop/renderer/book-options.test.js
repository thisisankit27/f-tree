import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_OPTIONS, scopeFor, todayIso, formatEstimate,
  decisionAllowance, canSave, decisionMessage, nextBookUsage, bookRequest,
  pickerGraph, featuresPerson, coverOptions,
} from './book-options.js';

test('DEFAULT_OPTIONS opens on the whole tree, without photos left off or dates widened', () => {
  assert.equal(DEFAULT_OPTIONS.scopeKind, 'everyone');
  assert.equal(DEFAULT_OPTIONS.photos, true);
  assert.equal(DEFAULT_OPTIONS.livingDates, false);
  assert.equal(DEFAULT_OPTIONS.titleOverride, null);
});

test('DEFAULT_OPTIONS lets the composer choose "whose story", and starts notes off (#249)', () => {
  // `null` -- not an id -- is what tells `book.js` "nobody has overridden `resolveFeatured` yet".
  assert.equal(DEFAULT_OPTIONS.featured, null);
  assert.equal(DEFAULT_OPTIONS.notes, false);
});

/* ---------------------------------------------------------------------------------------------
 * pickerGraph: the "Whose story" picker's own scope filtering (#249).
 *
 * hub -- w1 -- c1, c2
 *    \-- w2 -- c3, c4
 * ------------------------------------------------------------------------------------------- */

function docFixture() {
  return {
    format: 'f-tree', version: 1,
    people: [
      { id: 'hub', name: 'Hub Devi', gender: 'UNSPECIFIED' },
      { id: 'w1', name: 'Wife One', gender: 'FEMALE' },
      { id: 'w2', name: 'Wife Two', gender: 'FEMALE' },
      { id: 'c1', name: 'Child One', gender: 'MALE' },
      { id: 'c2', name: 'Child Two', gender: 'MALE' },
      { id: 'c3', name: 'Child Three', gender: 'FEMALE' },
      { id: 'c4', name: 'Child Four', gender: 'FEMALE' },
    ],
    relationships: [
      { id: 'r1', type: 'SPOUSE', from: 'hub', to: 'w1' },
      { id: 'r2', type: 'SPOUSE', from: 'hub', to: 'w2' },
      { id: 'r3', type: 'PARENT', from: 'hub', to: 'c1' },
      { id: 'r4', type: 'PARENT', from: 'w1', to: 'c1' },
      { id: 'r5', type: 'PARENT', from: 'hub', to: 'c2' },
      { id: 'r6', type: 'PARENT', from: 'w1', to: 'c2' },
      { id: 'r7', type: 'PARENT', from: 'hub', to: 'c3' },
      { id: 'r8', type: 'PARENT', from: 'w2', to: 'c3' },
      { id: 'r9', type: 'PARENT', from: 'hub', to: 'c4' },
      { id: 'r10', type: 'PARENT', from: 'w2', to: 'c4' },
    ],
  };
}

test('pickerGraph offers everyone in the file when the dialog was not scoped to a branch', () => {
  const graph = pickerGraph(docFixture(), { scopeKind: 'everyone' }, null);
  assert.deepEqual([...graph.people.keys()].sort(), ['c1', 'c2', 'c3', 'c4', 'hub', 'w1', 'w2']);
});

test('pickerGraph narrows to a branch exactly as the composer itself would (site/book/family.js)', () => {
  // w1's branch: her, her children by hub, and hub himself (her spouse) - never hub's other
  // marriage or its children, the same cut `branchFrom` makes for the composed book.
  const graph = pickerGraph(docFixture(), { scopeKind: 'branch' }, 'w1');
  assert.deepEqual([...graph.people.keys()].sort(), ['c1', 'c2', 'hub', 'w1']);
});

test('pickerGraph falls back to everyone when "branch" is asked for but no scope person is known', () => {
  // scopeFor's own rule: a branch request naming nobody is never honoured (book-options.js above).
  const graph = pickerGraph(docFixture(), { scopeKind: 'branch' }, null);
  assert.equal(graph.people.size, 7);
});

test('pickerGraph falls back to everyone when the named branch person is not actually in the file', () => {
  const graph = pickerGraph(docFixture(), { scopeKind: 'branch' }, 'nope');
  assert.equal(graph.people.size, 7);
});

/* ---------------------------------------------------------------------------------------------
 * featuresPerson: which templates the "Whose story" picker actually shapes anything on (#249).
 * ------------------------------------------------------------------------------------------- */

test('featuresPerson is true only for a format-2 story template', () => {
  assert.equal(featuresPerson({ format: 2 }), true);
  assert.equal(featuresPerson({ format: 1 }), false); // Heirloom, today
  assert.equal(featuresPerson(null), false);
  assert.equal(featuresPerson(undefined), false);
});

/* ---------------------------------------------------------------------------------------------
 * coverOptions: a template chip's own cover, stopped at the first page (#249).
 * ------------------------------------------------------------------------------------------- */

test('coverOptions carries every option through and adds coverOnly', () => {
  const base = { now: '2026-09-15', scope: { kind: 'everyone' }, photos: true };
  assert.deepEqual(coverOptions(base), { ...base, coverOnly: true });
});

test('coverOptions never mutates the options object it was given', () => {
  const base = { now: '2026-09-15' };
  coverOptions(base);
  assert.deepEqual(base, { now: '2026-09-15' });
});

test('scopeFor is everyone unless a branch was asked for and a person is known', () => {
  assert.deepEqual(scopeFor({ scopeKind: 'everyone' }, 'p1'), { kind: 'everyone' });
  assert.deepEqual(scopeFor({ scopeKind: 'branch' }, 'p1'), { kind: 'branch', personId: 'p1' });
  // Asked for a branch, but the dialog was not opened from a person: never a request naming nobody.
  assert.deepEqual(scopeFor({ scopeKind: 'branch' }, null), { kind: 'everyone' });
});

test('todayIso reads the local calendar date, not UTC', () => {
  // A date built from local components, so this holds wherever the test runner's TZ is set.
  const date = new Date(2026, 8, 5); // 5 September 2026, month is zero-based
  assert.equal(todayIso(date), '2026-09-05');
});

test('formatEstimate rounds to kilobytes below one megabyte, and to one decimal above it', () => {
  assert.equal(formatEstimate(0), 'About 0 MB');
  assert.equal(formatEstimate(-5), 'About 0 MB');
  assert.equal(formatEstimate(1), 'About 1 KB');
  assert.equal(formatEstimate(420_000), 'About 420 KB');
  assert.equal(formatEstimate(999_999), 'About 1000 KB');
  assert.equal(formatEstimate(1_000_000), 'About 1.0 MB');
  assert.equal(formatEstimate(3_400_000), 'About 3.4 MB');
  assert.equal(formatEstimate(9_842_000), 'About 9.8 MB');
});

test('decisionAllowance is empty unless the decision is Limited', () => {
  assert.deepEqual(decisionAllowance({ kind: 'allowed' }), {});
  assert.deepEqual(decisionAllowance({ kind: 'locked', reason: 'quota-used' }), {});
  assert.deepEqual(decisionAllowance(null), {});
  const limited = { kind: 'limited', allowance: { maxGenerations: 2 }, reason: 'generation-scope' };
  assert.deepEqual(decisionAllowance(limited), { maxGenerations: 2 });
});

test('canSave is false only for Locked', () => {
  assert.equal(canSave({ kind: 'allowed' }), true);
  assert.equal(canSave({ kind: 'limited', allowance: {} }), true);
  assert.equal(canSave({ kind: 'locked', reason: 'quota-used' }), false);
  assert.equal(canSave(null), true);
});

test('decisionMessage says nothing for a plain Allowed', () => {
  assert.equal(decisionMessage({ kind: 'allowed' }), null);
  assert.equal(decisionMessage(null), null);
});

test('every reason policy.js can hand back has a sentence', () => {
  // The reason codes documented at the top of site/book/policy.js. A code with no sentence here
  // would leave the dialog silent about why a book was limited or locked -- the same trap
  // nearby-words.test.js guards `nearby/problems.js` against.
  const REASONS = [
    'unknown-feature', 'quota-used', 'generation-scope', 'premium-template',
    'not-included', 'malformed-rule',
  ];
  for (const reason of REASONS) {
    const message = decisionMessage({ kind: 'locked', reason });
    assert.equal(typeof message, 'string', `no sentence for reason "${reason}"`);
    assert.ok(message.length > 0, `empty sentence for reason "${reason}"`);
  }
});

test('nextBookUsage counts one feature up, and starts anybody unseen at one', () => {
  assert.deepEqual(nextBookUsage({}, 'book.export'), { 'book.export': 1 });
  assert.deepEqual(
    nextBookUsage({ 'book.export': 2, 'book.template': 5 }, 'book.export'),
    { 'book.export': 3, 'book.template': 5 },
  );
  // Never the same object back, so a caller cannot mutate settings.bookUsage by accident.
  const usage = { 'book.export': 1 };
  assert.notEqual(nextBookUsage(usage, 'book.export'), usage);
});

test('nextBookUsage recovers from a corrupted or hand-edited count', () => {
  assert.deepEqual(nextBookUsage(null, 'book.export'), { 'book.export': 1 });
  assert.deepEqual(nextBookUsage({ 'book.export': 'lots' }, 'book.export'), { 'book.export': 1 });
});

test('bookRequest carries the free tier and the family\'s own shape', () => {
  assert.deepEqual(bookRequest({ templateId: 'heirloom', generations: 5, people: 42 }), {
    feature: 'book.export',
    templateId: 'heirloom',
    templateTier: 'free',
    generations: 5,
    people: 42,
  });
});

test('bookRequest carries the tier the catalogue gives the template', () => {
  assert.equal(bookRequest({ templateId: 'x', templateTier: 'premium', generations: 1, people: 1 }).templateTier, 'premium');
});
