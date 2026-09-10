/*
 * The rule the neighbour order exists for, stated as a rule.
 *
 * `kinship-golden.txt` guards this too, but it guards it by holding 753 lines of output, and "four
 * of those lines moved" is a proof nobody can read at a glance. This file says the thing itself:
 * where two routes are the same length, the one through the family wins.
 *
 * Ported from the reasoning at `app/.../graph/Kinship.kt:417-424`:
 *
 *   Marriage is walked as well as blood, because "my wife's mother" is exactly the sort of question
 *   this feature is asked, and no blood-only search can answer it. Blood steps are enqueued before
 *   marriage ones so that where two routes are the same length the one through the family wins --
 *   arriving at a cousin through their spouse would be a true answer and a useless one.
 */

import test from 'node:test';
import assert from 'node:assert';

import { buildGraph, relate } from './model.js';

/**
 * Two brothers married two sisters.
 *
 * My wife's sister is also my brother's wife. She is two steps away either way -- spouse then
 * sibling, or sibling then spouse -- so which of the two the search reaches her by is decided
 * entirely by the order the neighbours were enqueued in, and by nothing else.
 */
const twoAndTwo = () => buildGraph({
  people: [
    { id: 'me', name: 'Me', gender: 'MALE' },
    { id: 'brother', name: 'My Brother', gender: 'MALE' },
    { id: 'wife', name: 'My Wife', gender: 'FEMALE' },
    { id: 'her-sister', name: 'Her Sister', gender: 'FEMALE' },
    { id: 'our-father', name: 'Our Father', gender: 'MALE' },
    { id: 'their-father', name: 'Their Father', gender: 'MALE' },
  ],
  relationships: [
    { from: 'our-father', to: 'me', type: 'PARENT' },
    { from: 'our-father', to: 'brother', type: 'PARENT' },
    { from: 'their-father', to: 'wife', type: 'PARENT' },
    { from: 'their-father', to: 'her-sister', type: 'PARENT' },
    { from: 'me', to: 'wife', type: 'SPOUSE' },
    { from: 'brother', to: 'her-sister', type: 'SPOUSE' },
  ],
});

const chain = (graph, from, to) => relate(graph, from, to).path.map((step) => step.via);

test('where two routes tie, the one through the family wins', () => {
  const graph = twoAndTwo();

  // She is my brother's wife, not my wife's sister. Both are true; the blood route is the useful
  // one, because it reaches her through somebody I am related to rather than around the outside.
  assert.deepStrictEqual(chain(graph, 'me', 'her-sister'), ['sibling', 'spouse']);

  // And the same claim from each of the other three corners of the square, because a rule that
  // held in one direction only would be a coincidence.
  assert.deepStrictEqual(chain(graph, 'her-sister', 'me'), ['sibling', 'spouse']);
  assert.deepStrictEqual(chain(graph, 'brother', 'wife'), ['sibling', 'spouse']);
  assert.deepStrictEqual(chain(graph, 'wife', 'brother'), ['sibling', 'spouse']);
});

test('the tie is real: both routes are the same length', () => {
  // Without this the test above could be passing because the blood route is simply shorter, which
  // would prove nothing about the order at all.
  const graph = twoAndTwo();
  assert.strictEqual(relate(graph, 'me', 'her-sister').path.length, 2);
  assert.strictEqual(relate(graph, 'me', 'wife').path.length, 1);
  assert.strictEqual(relate(graph, 'me', 'brother').path.length, 1);
});

test('a shorter route still wins, whatever it is made of', () => {
  // The order decides ties and nothing else. My wife is one marriage step away and there is no
  // blood route to her at all, so preferring blood must not mean preferring a longer answer.
  const graph = twoAndTwo();
  assert.deepStrictEqual(chain(graph, 'me', 'wife'), ['spouse']);
  assert.deepStrictEqual(chain(graph, 'me', 'their-father'), ['spouse', 'parent']);
});

test('marriage is still walked, or in-laws would be unreachable', () => {
  // The reason the search is not blood-only in the first place: "my wife's mother" is exactly the
  // sort of question this feature is asked.
  const graph = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE' },
      { id: 'wife', name: 'My Wife', gender: 'FEMALE' },
      { id: 'her-mother', name: 'Her Mother', gender: 'FEMALE' },
    ],
    relationships: [
      { from: 'her-mother', to: 'wife', type: 'PARENT' },
      { from: 'me', to: 'wife', type: 'SPOUSE' },
    ],
  });

  assert.deepStrictEqual(chain(graph, 'me', 'her-mother'), ['spouse', 'parent']);
  assert.strictEqual(relate(graph, 'me', 'her-mother').term, 'mother-in-law');
});
