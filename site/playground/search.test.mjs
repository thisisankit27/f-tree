/*
 * What "find me a person" means, now that three places ask for it.
 *
 * These are new rather than ported -- the Kotlin's people list filters a Room query and shares no
 * code with this. They exist because the desktop and the website had drifted into two different
 * answers, and the point of moving the function here is that they cannot drift again.
 */

import test from 'node:test';
import assert from 'node:assert';

import { buildGraph } from './model.js';
import { searchPeople } from './search.js';

const graph = buildGraph({
  people: [
    { id: 'ram', name: 'Ram Lal', birthDate: '1935', deathDate: '1999' },
    { id: 'sitaram', name: 'Sitaram Prasad', birthDate: '1940' },
    { id: 'rama', name: 'Rama Devi', birthDate: '1962' },
    { id: 'nameless', name: null, birthDate: '1910' },
    { id: 'anita', name: 'Anita Kumar', birthDate: '1962' },
  ],
  relationships: [],
});

const ids = (query, limit) => searchPeople(graph, query, limit).map((p) => p.id);

test('a name that starts with the query comes before one that merely contains it', () => {
  // Typing "ram" should offer Ram Lal before Sitaram, which is the whole reason for ranking.
  assert.deepStrictEqual(ids('ram'), ['ram', 'rama', 'sitaram']);
});

test('the same query always gives the same list', () => {
  // Ties break on name rather than on file order, which is export order and means nothing.
  assert.deepStrictEqual(ids('ram'), ids('ram'));
});

test('somebody with no name recorded can still be found', () => {
  // They are drawn as "Unknown", and without this there is no way to search for them at all.
  assert.deepStrictEqual(ids('unknown'), ['nameless']);
  assert.deepStrictEqual(ids('unnamed'), ['nameless']);
});

test('a year finds whoever was born or died then', () => {
  // How somebody looks for a person whose name they cannot spell.
  assert.deepStrictEqual(ids('1962'), ['anita', 'rama']);
  assert.deepStrictEqual(ids('1999'), ['ram']);
});

test('one character is enough', () => {
  // The desktop's own version waited for two, so searching for a person called "Om" found nobody.
  assert.ok(ids('r').includes('ram'));
});

test('an empty query asks for nothing and gets nothing', () => {
  assert.deepStrictEqual(ids(''), []);
  assert.deepStrictEqual(ids('   '), []);
});

test('the limit is honoured', () => {
  assert.strictEqual(ids('a', 2).length, 2);
});

test('no graph is not a crash', () => {
  // The bar exists before a tree is open.
  assert.deepStrictEqual(searchPeople(null, 'ram'), []);
});
