/*
 * The two pieces of the compact view that are decisions rather than markup.
 *
 * `bands.js` mostly builds DOM, and there is no jsdom in this project -- the drawing is checked by
 * screenshotting the packaged app in both themes, which is what caught the sliced cards and the
 * monospace buttons in the import work. What is worth testing here is the arithmetic that turns a
 * generation's *distance* into a word, because it is the reason the bands are keyed by number: a
 * table of names runs out, and a chart that says "generation -5" has given up on being read aloud.
 */

import test from 'node:test';
import assert from 'node:assert';

import { bandHeading, summary } from './bands.js';
import { CompactFamily, CompactBand } from '../../site/playground/compact.js';

test('a generation is named from its distance, and the greats accumulate', () => {
  assert.strictEqual(bandHeading(0), 'Brothers and sisters');

  assert.strictEqual(bandHeading(-1), 'Parents');
  assert.strictEqual(bandHeading(-2), 'Grandparents');
  assert.strictEqual(bandHeading(-3), 'Great-grandparents');
  assert.strictEqual(bandHeading(-4), 'Great-great-grandparents');

  assert.strictEqual(bandHeading(1), 'Children');
  assert.strictEqual(bandHeading(2), 'Grandchildren');
  assert.strictEqual(bandHeading(3), 'Great-grandchildren');
  assert.strictEqual(bandHeading(4), 'Great-great-grandchildren');
});

test('a distance no table would have covered still gets a name', () => {
  // The point of deriving rather than looking up. Nobody will read eight generations up on one
  // page, and it should not say "generation -8" if they do.
  // Six greats, not five: -2 is the grandparents with no great at all, so the greats start at -3.
  assert.strictEqual(bandHeading(-8), 'Great-great-great-great-great-great-grandparents');
  assert.strictEqual(bandHeading(8), 'Great-great-great-great-great-great-grandchildren');
});

const familyOf = (offsets, truncated = false) => new CompactFamily({
  focus: { person: { id: 'me', name: 'Me' }, partners: [], ids: ['me'] },
  bands: offsets.map((offset) => new CompactBand(offset, [])),
  truncated,
});

test('the summary counts generations, not people', () => {
  // A reader deciding whether to ask for more wants to know how far this reaches, and a count of
  // people does not tell them.
  assert.strictEqual(
    summary(familyOf([-2, -1, 0, 1]), '3 generations'),
    '2 generations up, 1 generation down. That is everybody the record holds.',
  );
});

test('one generation is singular', () => {
  assert.strictEqual(
    summary(familyOf([-1]), '3 generations'),
    '1 generation up. That is everybody the record holds.',
  );
});

test('a person with nobody recorded is told so, not shown an empty page', () => {
  assert.strictEqual(
    summary(familyOf([]), '3 generations'),
    'nobody else recorded. That is everybody the record holds.',
  );
});

test('a truncated reading says where it stopped and offers to go on', () => {
  assert.strictEqual(
    summary(familyOf([-1, 1], true), '3 generations'),
    '1 generation up, 1 generation down. '
      + 'The record continues past 3 generations — ask for more to read it.',
  );
});

test("the focus's own row is not counted as a generation up or down", () => {
  // Offset 0 is the row the focus stands in. Counting it as a generation would make a person with
  // one brother and nothing else read as "1 generation down", which is a different family.
  assert.strictEqual(
    summary(familyOf([0]), '3 generations'),
    'nobody else recorded. That is everybody the record holds.',
  );
});
