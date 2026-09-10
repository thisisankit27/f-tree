/*
 * The arithmetic behind a stored photograph.
 *
 * The canvas work cannot be tested without a browser, but which square comes out of an image can,
 * and so can the two rules that make a desktop-written file the same as a phone-written one: 512px
 * on the longest edge, and never scaled up.
 */

import test from 'node:test';
import assert from 'node:assert';

import { squareCrop, storedEdge, freeName, STORED_EDGE, QUALITY } from './photo.js';

test('the constants are the app’s, not this file’s', () => {
  // PhotoStore.kt:186 and :191. A tree carried between a phone and a laptop should not change
  // weight every time it crosses.
  assert.strictEqual(STORED_EDGE, 512);
  assert.strictEqual(QUALITY, 85);
});

test('a square image is taken whole, wherever it is dragged', () => {
  assert.deepStrictEqual(squareCrop(600, 600, 0), { x: 0, y: 0, size: 600 });
  assert.deepStrictEqual(squareCrop(600, 600, 1), { x: 0, y: 0, size: 600 });
});

test('a landscape image is cut to its height and slid across', () => {
  // The square is always the largest that fits; the drag only says where along the long edge.
  assert.deepStrictEqual(squareCrop(1000, 400, 0), { x: 0, y: 0, size: 400 });
  assert.deepStrictEqual(squareCrop(1000, 400, 0.5), { x: 300, y: 0, size: 400 });
  assert.deepStrictEqual(squareCrop(1000, 400, 1), { x: 600, y: 0, size: 400 });
});

test('a portrait image is cut to its width and slid up or down', () => {
  // The case the drag exists for: a face is rarely in the middle of a portrait.
  assert.deepStrictEqual(squareCrop(400, 1000, 0), { x: 0, y: 0, size: 400 });
  assert.deepStrictEqual(squareCrop(400, 1000, 1), { x: 0, y: 600, size: 400 });
});

test('the default is the centre', () => {
  assert.deepStrictEqual(squareCrop(1000, 400), { x: 300, y: 0, size: 400 });
});

test('a drag past either end is clamped, not obeyed', () => {
  // A square running off the edge would be transparent there, and this format has no alpha.
  assert.deepStrictEqual(squareCrop(1000, 400, -3), { x: 0, y: 0, size: 400 });
  assert.deepStrictEqual(squareCrop(1000, 400, 99), { x: 600, y: 0, size: 400 });
  assert.deepStrictEqual(squareCrop(1000, 400, NaN), { x: 300, y: 0, size: 400 });
});

test('an image with no pixels asks for no square', () => {
  assert.deepStrictEqual(squareCrop(0, 0), { x: 0, y: 0, size: 0 });
  assert.deepStrictEqual(squareCrop(500, 0), { x: 0, y: 0, size: 0 });
});

test('a big photograph is cut down to 512', () => {
  assert.strictEqual(storedEdge(4000), 512);
  assert.strictEqual(storedEdge(513), 512);
});

test('a small photograph is left alone rather than blown up', () => {
  // Scaling up stores four times the bytes for none of the detail it started with.
  assert.strictEqual(storedEdge(200), 200);
  assert.strictEqual(storedEdge(512), 512);
});

test('a photograph gets a name nobody else in the tree is using', () => {
  const name = freeName(new Set());
  assert.match(name, /^photos\/[0-9a-f-]{36}\.jpg$/);
});

test('a name already taken is not handed out twice', () => {
  /*
   * Not superstition. Import brings photographs in under names chosen by another machine, so the
   * set really can already hold one -- and two people sharing an entry means replacing one
   * person's face replaces the other's as well.
   */
  const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  let i = 0;
  const name = freeName(new Set([`photos/${ids[0]}.jpg`]), () => ids[i++]);
  assert.strictEqual(name, `photos/${ids[1]}.jpg`);
});

test('it gives up rather than overwriting somebody’s face', () => {
  // Eight collisions on a v4 uuid does not happen; if it somehow did, refusing beats replacing.
  const always = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  assert.strictEqual(freeName(new Set([`photos/${always}.jpg`]), () => always), null);
});
