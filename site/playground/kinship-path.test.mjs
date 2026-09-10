/*
 * The part the arithmetic threw away.
 *
 * A kinship term is two distances, which is all English needs: an uncle is an uncle whichever
 * parent he belongs to. Hindi has five words where English has one, and choosing between them needs
 * to know which parent the line went up through, who it came back down through, and -- for चाचा
 * against ताऊ -- which of the two was born first.
 *
 * Nothing reads any of this yet. `kinship-golden.txt` not moving is the proof, and the proof is the
 * point: the path can be added and checked before any word depends on it, so that when the
 * vocabulary lands the only new thing is the vocabulary.
 */

import test from 'node:test';
import assert from 'node:assert';

import { buildGraph, relate } from './model.js';

/** A family with both sides recorded, so "which side" is a question with an answer. */
const bothSides = () => buildGraph({
  people: [
    { id: 'me', name: 'Me', gender: 'MALE', birthDate: '1990' },
    { id: 'father', name: 'Father', gender: 'MALE', birthDate: '1960' },
    { id: 'mother', name: 'Mother', gender: 'FEMALE', birthDate: '1962' },
    { id: 'fathers-elder-brother', name: 'Taau', gender: 'MALE', birthDate: '1955' },
    { id: 'fathers-younger-brother', name: 'Chacha', gender: 'MALE', birthDate: '1965' },
    { id: 'mothers-brother', name: 'Mama', gender: 'MALE', birthDate: '1958' },
    { id: 'grandfather', name: 'Dada', gender: 'MALE', birthDate: '1930' },
    { id: 'nana', name: 'Nana', gender: 'MALE', birthDate: '1932' },
  ],
  relationships: [
    { from: 'grandfather', to: 'father', type: 'PARENT' },
    { from: 'grandfather', to: 'fathers-elder-brother', type: 'PARENT' },
    { from: 'grandfather', to: 'fathers-younger-brother', type: 'PARENT' },
    { from: 'nana', to: 'mother', type: 'PARENT' },
    { from: 'nana', to: 'mothers-brother', type: 'PARENT' },
    { from: 'father', to: 'me', type: 'PARENT' },
    { from: 'mother', to: 'me', type: 'PARENT' },
  ],
});

const pathTo = (graph, id) => relate(graph, 'me', id).kinship;

test('the side the line went up is carried, which English throws away', () => {
  const graph = bothSides();

  // Both are "uncle" in English and are never the same word in Hindi.
  assert.strictEqual(pathTo(graph, 'fathers-elder-brother').side, 'MALE');
  assert.strictEqual(pathTo(graph, 'mothers-brother').side, 'FEMALE');

  // And English still says the same thing about both, which is the point of keeping them apart.
  assert.strictEqual(relate(graph, 'me', 'fathers-elder-brother').term, 'uncle');
  assert.strictEqual(relate(graph, 'me', 'mothers-brother').term, 'uncle');
});

test('the ascent runs from the subject’s own parent up to the shared ancestor', () => {
  const graph = bothSides();
  // Up through the father to the grandfather: two people, in that order.
  assert.deepStrictEqual(pathTo(graph, 'fathers-elder-brother').ascent, ['MALE', 'MALE']);
  // Up through the mother to her father.
  assert.deepStrictEqual(pathTo(graph, 'mothers-brother').ascent, ['FEMALE', 'MALE']);
});

test('the descent runs from the ancestor’s child down to the other person', () => {
  const graph = bothSides();
  const path = pathTo(graph, 'fathers-elder-brother');
  assert.deepStrictEqual(path.descent, ['MALE']);
  assert.strictEqual(path.link, 'MALE');
});

test('seniority compares the ancestor’s two children, not the two people', () => {
  /*
   * The comparison that decides ताऊ from चाचा is between my father and his brother -- not between
   * me and my uncle, who are a generation apart and would always come out the same way.
   */
  const graph = bothSides();
  // Born 1955 against my father's 1960: the elder.
  assert.strictEqual(pathTo(graph, 'fathers-elder-brother').seniority, 'ELDER');
  // Born 1965: the younger.
  assert.strictEqual(pathTo(graph, 'fathers-younger-brother').seniority, 'YOUNGER');
});

test('a sibling is compared against the subject themselves', () => {
  // Where the lines part at the subject, the subject *is* the ancestor's child being compared.
  const graph = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE', birthDate: '1990' },
      { id: 'elder', name: 'Elder', gender: 'MALE', birthDate: '1986' },
      { id: 'younger', name: 'Younger', gender: 'MALE', birthDate: '1994' },
      { id: 'dad', name: 'Dad', gender: 'MALE', birthDate: '1960' },
    ],
    relationships: [
      { from: 'dad', to: 'me', type: 'PARENT' },
      { from: 'dad', to: 'elder', type: 'PARENT' },
      { from: 'dad', to: 'younger', type: 'PARENT' },
    ],
  });

  assert.strictEqual(pathTo(graph, 'elder').seniority, 'ELDER');
  assert.strictEqual(pathTo(graph, 'younger').seniority, 'YOUNGER');
});

test('seniority is claimed only where the dates prove it', () => {
  /*
   * The rule worth being strict about. Two brothers both recorded as "1962" could be either way
   * round, and guessing produces a word that is wrong to somebody's face -- calling a man's elder
   * brother by the younger word is not a rounding error at a family gathering.
   */
  const sameYear = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE', birthDate: '1990' },
      { id: 'dad', name: 'Dad', gender: 'MALE', birthDate: '1962' },
      { id: 'uncle', name: 'Uncle', gender: 'MALE', birthDate: '1962' },
      { id: 'grandad', name: 'Grandad', gender: 'MALE', birthDate: '1930' },
    ],
    relationships: [
      { from: 'grandad', to: 'dad', type: 'PARENT' },
      { from: 'grandad', to: 'uncle', type: 'PARENT' },
      { from: 'dad', to: 'me', type: 'PARENT' },
    ],
  });
  assert.strictEqual(pathTo(sameYear, 'uncle').seniority, 'UNKNOWN');
});

test('a year against a month inside it is still unknown', () => {
  // "1962" covers all of 1962, so "1962-04" could be before or after somebody merely "1962".
  const graph = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE', birthDate: '1990' },
      { id: 'dad', name: 'Dad', gender: 'MALE', birthDate: '1962' },
      { id: 'uncle', name: 'Uncle', gender: 'MALE', birthDate: '1962-04' },
      { id: 'grandad', name: 'Grandad', gender: 'MALE', birthDate: '1930' },
    ],
    relationships: [
      { from: 'grandad', to: 'dad', type: 'PARENT' },
      { from: 'grandad', to: 'uncle', type: 'PARENT' },
      { from: 'dad', to: 'me', type: 'PARENT' },
    ],
  });
  assert.strictEqual(pathTo(graph, 'uncle').seniority, 'UNKNOWN');
});

test('two months that cannot overlap are proof enough', () => {
  const graph = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE', birthDate: '1990' },
      { id: 'dad', name: 'Dad', gender: 'MALE', birthDate: '1962-09' },
      { id: 'uncle', name: 'Uncle', gender: 'MALE', birthDate: '1962-04' },
      { id: 'grandad', name: 'Grandad', gender: 'MALE', birthDate: '1930' },
    ],
    relationships: [
      { from: 'grandad', to: 'dad', type: 'PARENT' },
      { from: 'grandad', to: 'uncle', type: 'PARENT' },
      { from: 'dad', to: 'me', type: 'PARENT' },
    ],
  });
  assert.strictEqual(pathTo(graph, 'uncle').seniority, 'ELDER');
});

test('nobody with a recorded date means nobody is the elder', () => {
  const graph = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE' },
      { id: 'dad', name: 'Dad', gender: 'MALE' },
      { id: 'uncle', name: 'Uncle', gender: 'MALE' },
      { id: 'grandad', name: 'Grandad', gender: 'MALE' },
    ],
    relationships: [
      { from: 'grandad', to: 'dad', type: 'PARENT' },
      { from: 'grandad', to: 'uncle', type: 'PARENT' },
      { from: 'dad', to: 'me', type: 'PARENT' },
    ],
  });
  assert.strictEqual(pathTo(graph, 'uncle').seniority, 'UNKNOWN');
});

test('a relationship through marriage is measured over its blood half', () => {
  /*
   * The case that tells साला from जेठ. My wife's brother is reached over *her* line, so the path is
   * hers -- while the gender that decides the word stays mine. They are carried separately for
   * exactly that reason.
   */
  const graph = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE', birthDate: '1990' },
      { id: 'wife', name: 'Wife', gender: 'FEMALE', birthDate: '1992' },
      { id: 'her-brother', name: 'Her Brother', gender: 'MALE', birthDate: '1988' },
      { id: 'her-father', name: 'Her Father', gender: 'MALE', birthDate: '1960' },
    ],
    relationships: [
      { from: 'me', to: 'wife', type: 'SPOUSE' },
      { from: 'her-father', to: 'wife', type: 'PARENT' },
      { from: 'her-father', to: 'her-brother', type: 'PARENT' },
    ],
  });

  const answer = relate(graph, 'me', 'her-brother');
  assert.strictEqual(answer.term, 'brother-in-law');
  // Measured from the wife: her brother is the elder of the two siblings.
  assert.strictEqual(answer.kinship.seniority, 'ELDER');
  assert.deepStrictEqual(answer.kinship.ascent, ['MALE']);
});

test('two people with no shared ancestor carry no path', () => {
  const graph = buildGraph({
    people: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    relationships: [],
  });
  assert.strictEqual(relate(graph, 'a', 'b').kinship, null);
});

test('the structured term travels with the path', () => {
  /*
   * A vocabulary needs the two together and nothing else: which relative this is, and who it was
   * measured through. Keeping them in one object is what lets a second language be a file that
   * reads `relate(...).kinship` and touches `model.js` not at all.
   */
  const graph = bothSides();
  const answer = relate(graph, 'me', 'fathers-elder-brother');
  assert.deepStrictEqual(answer.kinship.term, { kind: 'parents-sibling', greats: 0 });
});

test('a marriage wraps the blood relative it reaches, rather than flattening it', () => {
  /*
   * `termFor` cannot produce these: they are not two distances, they are a distance *and* a
   * marriage. English mostly does not tell them apart -- "brother-in-law" is both -- and Hindi
   * always does, which is why the shape is kept even though nothing reads it yet.
   */
  const graph = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE', birthDate: '1990' },
      { id: 'wife', name: 'Wife', gender: 'FEMALE', birthDate: '1992' },
      { id: 'her-brother', name: 'Her Brother', gender: 'MALE', birthDate: '1988' },
      { id: 'her-father', name: 'Her Father', gender: 'MALE', birthDate: '1960' },
      { id: 'sister', name: 'Sister', gender: 'FEMALE', birthDate: '1987' },
      { id: 'her-husband', name: 'Her Husband', gender: 'MALE', birthDate: '1985' },
      { id: 'dad', name: 'Dad', gender: 'MALE', birthDate: '1960' },
    ],
    relationships: [
      { from: 'me', to: 'wife', type: 'SPOUSE' },
      { from: 'her-father', to: 'wife', type: 'PARENT' },
      { from: 'her-father', to: 'her-brother', type: 'PARENT' },
      { from: 'dad', to: 'me', type: 'PARENT' },
      { from: 'dad', to: 'sister', type: 'PARENT' },
      { from: 'sister', to: 'her-husband', type: 'SPOUSE' },
    ],
  });

  // A blood relative of the person I married: साला, not जीजा.
  assert.deepStrictEqual(relate(graph, 'me', 'her-brother').kinship.term, {
    kind: 'of-spouse', relative: { kind: 'sibling' },
  });

  // Somebody married to a blood relative of mine: जीजा, not साला. English calls both
  // "brother-in-law", which is exactly the collapse this shape exists to survive.
  assert.deepStrictEqual(relate(graph, 'me', 'her-husband').kinship.term, {
    kind: 'spouse-of', relative: { kind: 'sibling' },
  });

  assert.strictEqual(relate(graph, 'me', 'her-brother').term, 'brother-in-law');
  assert.strictEqual(relate(graph, 'me', 'her-husband').term, 'brother-in-law');
});

test('the subject’s own spouse is its own kind', () => {
  const graph = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE' },
      { id: 'wife', name: 'Wife', gender: 'FEMALE' },
    ],
    relationships: [{ from: 'me', to: 'wife', type: 'SPOUSE' }],
  });
  assert.deepStrictEqual(relate(graph, 'me', 'wife').kinship.term, { kind: 'spouse' });
});
