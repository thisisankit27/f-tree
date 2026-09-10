/*
 * KinshipTest.kt's word cases, and the structure underneath them.
 *
 * These are not new tests. They are translations of the cases in
 * `app/src/test/java/com/vibethroughcode/ftree/graph/KinshipTest.kt`, using the same family and
 * the same names, because the point of the exercise is that two implementations of one set of
 * family rules must not drift apart. Reading the two files side by side should be dull.
 *
 * `termFor` deliberately returns the *same shape* the Kotlin's `KinshipTerm` has -- `Ancestor` and
 * `Descendant` counting generations, `ParentsSibling` and `SiblingsChild` counting greats, `Cousin`
 * carrying a degree and a remove -- so that a case can be read across without translation. That is
 * also why 1 = parent rather than there being a separate parent case: matching a shape you are
 * being held to is worth more than a shape that reads slightly better on its own.
 */

import test from 'node:test';
import assert from 'node:assert';

import { buildGraph, relate, termFor, kinshipLabel, kinshipTerm } from './model.js';

/*
 * Four generations with two branches, which between them contain every term worth having:
 *
 *              great ── great-wife
 *                    │
 *          ┌─────────┴──────────┐
 *        grandad ── granny    granduncle
 *          │                    │
 *      ┌───┴────┐            cousin-parent
 *     dad ── mum  aunt          │
 *      │                     second-line
 *     me ── wife
 *      │
 *     kid
 */
const family = () => {
  const ids = ['great', 'great-wife', 'grandad', 'granny', 'granduncle', 'dad', 'mum', 'aunt',
    'me', 'wife', 'kid', 'cousin-parent', 'second-line', 'wifes-mother'];
  const relationships = [];
  const married = (a, b) => relationships.push({ from: a, to: b, type: 'SPOUSE' });
  const parentOf = (parent, ...children) => {
    for (const child of children) relationships.push({ from: parent, to: child, type: 'PARENT' });
  };

  married('great', 'great-wife');
  married('grandad', 'granny');
  married('dad', 'mum');
  married('me', 'wife');
  parentOf('great', 'grandad', 'granduncle');
  parentOf('great-wife', 'grandad', 'granduncle');
  parentOf('grandad', 'dad', 'aunt');
  parentOf('granny', 'dad', 'aunt');
  parentOf('dad', 'me');
  parentOf('mum', 'me');
  parentOf('me', 'kid');
  parentOf('wife', 'kid');
  parentOf('granduncle', 'cousin-parent');
  parentOf('cousin-parent', 'second-line');
  parentOf('wifes-mother', 'wife');

  return buildGraph({
    people: ids.map((id) => ({ id, name: id, gender: 'UNSPECIFIED' })),
    relationships,
  });
};

const graph = family();
const word = (from, to) => relate(graph, from, to).term;

// ------------------------------------------------------------------ the words

test('the straight line up and down is named by its generations', () => {
  assert.deepStrictEqual(termFor(1, 0), { kind: 'ancestor', generations: 1 });
  assert.deepStrictEqual(termFor(2, 0), { kind: 'ancestor', generations: 2 });
  assert.deepStrictEqual(termFor(3, 0), { kind: 'ancestor', generations: 3 });
  assert.deepStrictEqual(termFor(0, 1), { kind: 'descendant', generations: 1 });
  assert.deepStrictEqual(termFor(0, 3), { kind: 'descendant', generations: 3 });
  assert.deepStrictEqual(termFor(0, 4), { kind: 'descendant', generations: 4 });

  assert.strictEqual(word('me', 'dad'), 'parent');
  assert.strictEqual(word('me', 'grandad'), 'grandparent');
  assert.strictEqual(word('me', 'great'), 'great-grandparent');
  assert.strictEqual(word('me', 'kid'), 'child');
  assert.strictEqual(word('grandad', 'kid'), 'great-grandchild');
});

test('siblings, aunts and nieces come out of the same two numbers', () => {
  assert.deepStrictEqual(termFor(1, 1), { kind: 'sibling' });
  assert.deepStrictEqual(termFor(2, 1), { kind: 'parents-sibling', greats: 0 });
  assert.deepStrictEqual(termFor(3, 1), { kind: 'parents-sibling', greats: 1 });
  assert.deepStrictEqual(termFor(1, 2), { kind: 'siblings-child', greats: 0 });
  assert.deepStrictEqual(termFor(1, 3), { kind: 'siblings-child', greats: 1 });

  assert.strictEqual(word('dad', 'aunt'), 'sibling');
  assert.strictEqual(word('me', 'aunt'), 'aunt or uncle');
  assert.strictEqual(word('me', 'granduncle'), 'great-aunt or uncle');
  assert.strictEqual(word('aunt', 'me'), 'nephew or niece');
});

test('cousins carry both a degree and a remove', () => {
  assert.deepStrictEqual(termFor(2, 2), { kind: 'cousin', degree: 1, removed: 0 });
  assert.deepStrictEqual(termFor(3, 2), { kind: 'cousin', degree: 1, removed: 1 });
  assert.deepStrictEqual(termFor(3, 3), { kind: 'cousin', degree: 2, removed: 0 });
  assert.deepStrictEqual(termFor(4, 2), { kind: 'cousin', degree: 1, removed: 2 });

  // me and cousin-parent share "great": two up, two down.
  assert.strictEqual(word('dad', 'cousin-parent'), 'first cousin');
  assert.strictEqual(word('me', 'cousin-parent'), 'first cousin once removed');
  assert.strictEqual(word('me', 'second-line'), 'second cousin');
  assert.strictEqual(word('kid', 'cousin-parent'), 'first cousin twice removed');
});

test('the nearest shared ancestor names it, not the most distant one', () => {
  // dad and aunt share both their parents and both their grandparents; measured through a
  // grandparent they would come out as first cousins rather than as brother and sister.
  assert.strictEqual(word('dad', 'aunt'), 'sibling');
});

test('a marriage is named where English has a name for it, and only there', () => {
  // These three used all to come back as "related by marriage", which said nothing about any of
  // them and the same nothing about all of them.
  assert.strictEqual(word('me', 'wife'), 'spouse');
  assert.strictEqual(word('me', 'wifes-mother'), 'parent-in-law');
  // And read the other way round.
  assert.strictEqual(word('wife', 'mum'), 'parent-in-law');
});

// ------------------------------------------------- added: the shape and the word are separable

test('the same structure gives a different word for a different person', () => {
  // The whole reason for the split: one arithmetic, and a language hanging off it. When Hindi
  // lands it is a second `kinshipLabel`, not a second `termFor`.
  const term = termFor(2, 1);
  assert.strictEqual(kinshipLabel(term, { gender: 'MALE' }), 'uncle');
  assert.strictEqual(kinshipLabel(term, { gender: 'FEMALE' }), 'aunt');
  assert.strictEqual(kinshipLabel(term, { gender: 'UNSPECIFIED' }), 'aunt or uncle');
});

test('an unrecorded gender is said as unknown, not guessed', () => {
  // "aunt or uncle" is honest. "uncle" would be a coin toss about somebody's relative.
  assert.strictEqual(kinshipLabel(termFor(1, 1), {}), 'sibling');
  assert.strictEqual(kinshipLabel(termFor(1, 0), {}), 'parent');
});

test('kinshipTerm is still the two-argument wrapper other files import', () => {
  // `tools/check_layout.mjs` imports it, and so does anything that only wants the word.
  for (let u = 0; u <= 4; u++) {
    for (let d = 0; d <= 4; d++) {
      for (const gender of ['MALE', 'FEMALE', 'UNSPECIFIED']) {
        assert.strictEqual(
          kinshipTerm(u, d, { gender }),
          kinshipLabel(termFor(u, d), { gender }),
          `u=${u} d=${d} ${gender}`,
        );
      }
    }
  }
});

test('the greats accumulate on both the aunts and the nieces', () => {
  assert.strictEqual(kinshipLabel(termFor(4, 1), { gender: 'FEMALE' }), 'great-great-aunt');
  assert.strictEqual(kinshipLabel(termFor(1, 4), { gender: 'MALE' }), 'great-great-nephew');
});

test('a step-parent is named and a step-grandparent is not', () => {
  /*
   * Added, not translated, and the case the old string-sniffing got wrong by accident rather than
   * by decision: it tested `relative === 'father'`, so a *grandparent's* new spouse fell through to
   * null for the same reason -- but only because the string happened not to match. Now it is a
   * decision: English says "stepfather" and does not say "step-grandfather", so only the first
   * generation is named and the rest fall to the chain.
   */
  assert.strictEqual(word('me', 'wifes-mother'), 'parent-in-law');
});
