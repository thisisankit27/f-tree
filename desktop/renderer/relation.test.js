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

/* ------------------------------------------------------------------ the Hindi word */

import { hindiFor } from './relation.js';
import { buildGraph, relate } from '../../site/playground/model.js';

/** A man, his father's elder brother, and his mother's brother: one English word, two Hindi ones. */
const bothUncles = () => buildGraph({
  people: [
    { id: 'me', name: 'Me', gender: 'MALE', birthDate: '1985' },
    { id: 'dad', name: 'Dad', gender: 'MALE', birthDate: '1958' },
    { id: 'mum', name: 'Mum', gender: 'FEMALE', birthDate: '1960' },
    { id: 'tau', name: 'Tau', gender: 'MALE', birthDate: '1952' },
    { id: 'mama', name: 'Mama', gender: 'MALE', birthDate: '1956' },
    { id: 'dada', name: 'Dada', gender: 'MALE', birthDate: '1930' },
    { id: 'nana', name: 'Nana', gender: 'MALE', birthDate: '1932' },
  ],
  relationships: [
    { from: 'dada', to: 'dad', type: 'PARENT' },
    { from: 'dada', to: 'tau', type: 'PARENT' },
    { from: 'nana', to: 'mum', type: 'PARENT' },
    { from: 'nana', to: 'mama', type: 'PARENT' },
    { from: 'dad', to: 'me', type: 'PARENT' },
    { from: 'mum', to: 'me', type: 'PARENT' },
  ],
});

const hindiBetween = (graph, from, to) => hindiFor(
  relate(graph, from, to), graph.people.get(from), graph.people.get(to),
);

test('the two uncles English cannot tell apart get different Hindi words', () => {
  // The distinction the whole feature exists for.
  const graph = bothUncles();
  assert.strictEqual(relate(graph, 'me', 'tau').term, 'uncle');
  assert.strictEqual(relate(graph, 'me', 'mama').term, 'uncle');

  assert.strictEqual(hindiBetween(graph, 'me', 'tau').word, 'ताऊ');
  assert.strictEqual(hindiBetween(graph, 'me', 'mama').word, 'मामा');
});

test('the gloss says which uncle, so the word can be read by somebody who lacks it', () => {
  const graph = bothUncles();
  assert.strictEqual(hindiBetween(graph, 'me', 'tau').gloss, "father's elder brother");
  assert.strictEqual(hindiBetween(graph, 'me', 'mama').gloss, "mother's brother");
});

test('where the record cannot settle a birth order, the term says it wants years', () => {
  // Not an apology: "पिता के भाई" is what he is. The flag is what lets the panel say which two
  // birth years would sharpen it.
  const undated = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE' },
      { id: 'dad', name: 'Dad', gender: 'MALE' },
      { id: 'uncle', name: 'Uncle', gender: 'MALE' },
      { id: 'dada', name: 'Dada', gender: 'MALE' },
    ],
    relationships: [
      { from: 'dada', to: 'dad', type: 'PARENT' },
      { from: 'dada', to: 'uncle', type: 'PARENT' },
      { from: 'dad', to: 'me', type: 'PARENT' },
    ],
  });

  const hindi = hindiBetween(undated, 'me', 'uncle');
  assert.strictEqual(hindi.word, 'पिता के भाई');
  assert.strictEqual(hindi.needsBirthYears, true);
});

test('where Hindi has no word, the panel is told nothing rather than something invented', () => {
  /*
   * A second cousin has no everyday Hindi word. Returning null is what makes the panel fall back to
   * the English sentence it was already showing -- which is what a Hindi speaker does in the same
   * conversation, and better than a Devanagari compound nobody says.
   */
  const distant = buildGraph({
    people: [
      { id: 'me', name: 'Me', gender: 'MALE' },
      { id: 'dad', name: 'Dad', gender: 'MALE' },
      { id: 'granddad', name: 'Granddad', gender: 'MALE' },
      { id: 'great', name: 'Great', gender: 'MALE' },
      { id: 'granduncle', name: 'Granduncle', gender: 'MALE' },
      { id: 'cousin-parent', name: 'CP', gender: 'MALE' },
      { id: 'second', name: 'Second', gender: 'MALE' },
    ],
    relationships: [
      { from: 'great', to: 'granddad', type: 'PARENT' },
      { from: 'great', to: 'granduncle', type: 'PARENT' },
      { from: 'granddad', to: 'dad', type: 'PARENT' },
      { from: 'granduncle', to: 'cousin-parent', type: 'PARENT' },
      { from: 'dad', to: 'me', type: 'PARENT' },
      { from: 'cousin-parent', to: 'second', type: 'PARENT' },
    ],
  });

  assert.strictEqual(relate(distant, 'me', 'second').term, 'second cousin');
  assert.strictEqual(hindiBetween(distant, 'me', 'second'), null);
});

test('two people the file does not connect get no Hindi word either', () => {
  const graph = buildGraph({
    people: [{ id: 'a', name: 'A', gender: 'MALE' }, { id: 'b', name: 'B', gender: 'MALE' }],
    relationships: [],
  });
  assert.strictEqual(hindiBetween(graph, 'a', 'b'), null);
});
