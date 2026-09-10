/*
 * Which sentence an answer gets, and when it gets none.
 *
 * The three shapes are a wording decision rather than an engine one, so they are checked here as a
 * table. The fourth case -- no sentence at all -- is the one most worth pinning, because the
 * tempting thing to do is fill it, and filling it is what made the website's earlier attempt
 * useless.
 */

import test from 'node:test';
import assert from 'node:assert';

import { sentenceFor, unrelatedWording } from './relation.js';

const ankit = { id: 'ankit', name: 'Ankit Kumar', gender: 'MALE' };
const priya = { id: 'priya', name: 'Priya Sharma', gender: 'FEMALE' };
const wife = { id: 'wife', name: 'Anita Kumar', gender: 'FEMALE' };

/** The sentence as a plain string, for reading in an assertion. */
const said = (parts) => (parts ?? []).map((p) => {
  if (typeof p === 'string') return p;
  if (p.term) return `*${p.term}*`;
  return p.name.name ?? 'Unknown';
}).join('');

test('a blood relationship is a noun', () => {
  assert.strictEqual(
    said(sentenceFor({ kind: 'related', term: 'first cousin' }, ankit, priya)),
    'Priya Sharma is Ankit Kumar’s *first cousin*.',
  );
});

test('a marriage at the far end is turned around rather than possessed twice', () => {
  // "Ankit's first cousin once removed's wife" is a chain nobody says out loud.
  assert.strictEqual(
    said(sentenceFor(
      { kind: 'related', marriedTo: { term: 'first cousin once removed', person: priya } },
      ankit, wife,
    )),
    'Anita Kumar is married to Ankit Kumar’s *first cousin once removed*.',
  );
});

test('a relative of the person somebody married is named through them', () => {
  assert.strictEqual(
    said(sentenceFor(
      { kind: 'related', ofSpouse: { term: 'mother', spouse: wife } },
      ankit, priya,
    )),
    'Priya Sharma is the *mother* of Ankit Kumar’s wife.',
  );
});

test('where no word fits, there is no sentence', () => {
  /*
   * The case worth pinning. "Connected only through marriage" was tried and was worse than
   * nothing: every relative anybody had married into the family came back under the same flat
   * phrase, so it stopped telling a reader anything. The chain says it exactly instead.
   */
  assert.strictEqual(sentenceFor({ kind: 'related', term: null }, ankit, priya), null);
  assert.strictEqual(
    sentenceFor({ kind: 'related', term: null, marriedTo: null, ofSpouse: null }, ankit, priya),
    null,
  );
});

test('a term wins over the other two, so an answer never gets two sentences', () => {
  const both = { kind: 'related', term: 'sister', marriedTo: { term: 'brother', person: priya } };
  assert.strictEqual(said(sentenceFor(both, ankit, priya)), 'Priya Sharma is Ankit Kumar’s *sister*.');
});

test('an answer that is not a relationship gets no sentence', () => {
  assert.strictEqual(sentenceFor({ kind: 'none' }, ankit, priya), null);
  assert.strictEqual(sentenceFor({ kind: 'same' }, ankit, ankit), null);
  assert.strictEqual(sentenceFor(null, ankit, priya), null);
});

test('two people the file does not connect are told exactly that', () => {
  // And told that the record is what is silent, not that they are unrelated -- which the file
  // cannot know and this app must not claim.
  const words = said(unrelatedWording(ankit, priya));
  assert.match(words, /^Nothing in this file connects Ankit Kumar to Priya Sharma\./);
  assert.match(words, /may still be related — the record simply does not say how/);
});
