/*
 * PartialDateTest.kt, for the parts the import depends on.
 *
 * Translated case for case where a case exists there. Formatting, ordering and `yearsBetween` are
 * not ported -- `model.js` already formats and nothing here orders dates -- so those cases are
 * absent rather than reimplemented.
 */

import test from 'node:test';
import assert from 'node:assert';

import { parsePartialDate } from './dates.js';

const at = (s) => parsePartialDate(s);

test('parses all three precisions', () => {
  assert.deepStrictEqual(
    [at('1938').year, at('1938').month, at('1938').day], [1938, null, null]);
  assert.deepStrictEqual(
    [at('1938-04').year, at('1938-04').month, at('1938-04').day], [1938, 4, null]);
  assert.deepStrictEqual(
    [at('1938-04-17').year, at('1938-04-17').month, at('1938-04-17').day], [1938, 4, 17]);
});

test('rejects malformed and impossible dates', () => {
  for (const bad of [null, undefined, '', '38', '1938-4-17', '1938-13', '1938-02-30', 'not a date']) {
    assert.strictEqual(at(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('round trips through serialisation', () => {
  for (const value of ['1938', '1938-04', '1938-04-17']) {
    assert.strictEqual(at(value).serialize(), value);
  }
});

test('a year spans the whole year', () => {
  assert.strictEqual(at('1938').earliest(), 19380101);
  assert.strictEqual(at('1938').latest(), 19381231);
});

test('a month spans that month including a leap day', () => {
  assert.strictEqual(at('2024-02').earliest(), 20240201);
  assert.strictEqual(at('2024-02').latest(), 20240229);
});

test('the leap rule is the real one, not every fourth year', () => {
  // Added here. 1900 is not a leap year and 2000 is; a naive `% 4` gets 1900 wrong, which would
  // silently accept 1900-02-29 as a real date and could rule out a correct match.
  assert.strictEqual(at('1900-02').latest(), 19000228);
  assert.strictEqual(at('2000-02').latest(), 20000229);
  assert.strictEqual(at('1900-02-29'), null);
  assert.ok(at('2000-02-29'));
});

test('dates of differing precision are compatible when they could be the same day', () => {
  const year = at('1938');
  const exact = at('1938-04-17');
  const otherYear = at('1939');

  assert.ok(year.isCompatibleWith(exact));
  assert.ok(exact.isCompatibleWith(year));
  assert.ok(!year.isCompatibleWith(otherYear));
});

test('compatibility is symmetric, in both directions, for every pair', () => {
  // Added here. The check is used to rule a match *out*, so an asymmetry would make the answer
  // depend on which file happened to be the one being imported.
  const values = ['1938', '1938-04', '1938-04-17', '1939', '1938-05', '2024-02-29'];
  for (const a of values) {
    for (const b of values) {
      assert.strictEqual(
        at(a).isCompatibleWith(at(b)), at(b).isCompatibleWith(at(a)),
        `${a} vs ${b} disagreed depending on the order`);
    }
  }
});

test('a day inside a month is compatible with that month, and outside it is not', () => {
  assert.ok(at('1938-04').isCompatibleWith(at('1938-04-17')));
  assert.ok(!at('1938-04').isCompatibleWith(at('1938-05-17')));
});
