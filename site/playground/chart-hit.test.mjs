/*
 * Which card is under the pointer.
 *
 * chart.js went without a test from the day it was written, and this is what that cost: the spatial
 * index filed each card in the one 400x400 bucket holding its top-left corner, while a card is
 * 188x64 and the lookup reads only the bucket under the click. Any card straddling a bucket edge was
 * dead in the part that spilled across it -- up to 150px of a 188px card, leaving a strip at the
 * left that happened to be where the photograph is drawn. Reported as "only clickable near the
 * photo" on a 150-person tree, and present in the website viewer too, because it shares the file.
 *
 * Everything that asks "which person is here?" goes through this one function: hover, the click
 * that opens the person panel, and the double-click that centres. So it is tested on its own,
 * without a canvas, in both orientations the engine can draw.
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openArchive, parseDocument } from './archive.js';
import { buildGraph } from './model.js';
import { layoutArchive, METRICS } from './layout.js';
import { spatialIndex, nodeAtPoint, HIT_CELL } from './chart.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAMILY = path.join(here, 'sample-family.ftree');

const { NODE_W, NODE_H } = METRICS;

function hit(nodes, x, y) {
  return nodeAtPoint(spatialIndex(nodes, METRICS), METRICS, x, y)?.id ?? null;
}

/** Every point a reader could reasonably click on a card: the four corners and the middle. */
function pointsOn(node) {
  return [
    ['top-left', node.x, node.y],
    ['top-right', node.x + NODE_W, node.y],
    ['bottom-left', node.x, node.y + NODE_H],
    ['bottom-right', node.x + NODE_W, node.y + NODE_H],
    ['centre', node.x + NODE_W / 2, node.y + NODE_H / 2],
  ];
}

test('the cell is the one these cases were measured against', () => {
  // The cases below place cards across the edge of a 400-unit cell. If the cell changes they stop
  // straddling anything and pass for the wrong reason.
  assert.strictEqual(HIT_CELL, 400);
});

test('a card straddling a vertical bucket edge is live on both sides of it', () => {
  // Spans x 300..488, so the edge at 400 runs through it.
  const nodes = [{ id: 'a', x: 300, y: 20 }];
  assert.strictEqual(hit(nodes, 320, 50), 'a', 'left of the edge');
  assert.strictEqual(hit(nodes, 470, 50), 'a', 'right of the edge -- the part that was dead');
});

test('a card straddling a horizontal bucket edge is live above and below it', () => {
  // Spans y 370..434.
  const nodes = [{ id: 'a', x: 20, y: 370 }];
  assert.strictEqual(hit(nodes, 100, 380), 'a', 'above the edge');
  assert.strictEqual(hit(nodes, 100, 425), 'a', 'below the edge');
});

test('a card over a corner of four buckets is live in all four', () => {
  // Spans x 300..488 and y 370..434, so it sits in four cells at once.
  const nodes = [{ id: 'a', x: 300, y: 370 }];
  for (const [x, y] of [[320, 380], [480, 380], [320, 430], [480, 430]]) {
    assert.strictEqual(hit(nodes, x, y), 'a', `at ${x},${y}`);
  }
});

test('a card across the origin is live at negative coordinates too', () => {
  // `Math.floor` of a negative number rounds away from zero; a truncating index would lose this.
  const nodes = [{ id: 'a', x: -100, y: -30 }];
  assert.strictEqual(hit(nodes, -90, -20), 'a');
  assert.strictEqual(hit(nodes, 80, 30), 'a');
});

test('the gap between two cards is still nobody', () => {
  // The fix files a card in every bucket it touches. That must not make the bucket's whole area
  // answer for it: between two cards is empty paper, and clicking it deselects.
  const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }];
  assert.strictEqual(hit(nodes, 240, 30), null, 'between the two cards');
  assert.strictEqual(hit(nodes, 100, 200), null, 'below them, in the same bucket');
  assert.strictEqual(hit(nodes, 100, 30), 'a');
  assert.strictEqual(hit(nodes, 400, 30), 'b');
});

test('a point on no card at all, in a bucket nobody is in, is nobody', () => {
  assert.strictEqual(hit([{ id: 'a', x: 0, y: 0 }], 5000, 5000), null);
});

/** `openArchive` wants an ArrayBuffer; `readFile` gives a Buffer over a shared one. */
async function familyGraph() {
  const buffer = await readFile(FAMILY);
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const archive = await openArchive(bytes);
  return buildGraph(parseDocument(await archive.readText('tree.json')));
}

for (const orientation of ['rows', 'columns']) {
  test(`every card in the sample family answers at its corners and centre (${orientation})`, async () => {
    const graph = await familyGraph();
    const layout = layoutArchive(graph, { orientation });
    const index = spatialIndex(layout.nodes, layout.metrics);

    // A fixture where nothing straddles a bucket edge would pass on the old code too, and prove
    // nothing. Measured on this one: rows 38%, columns 54% of cards cross an edge.
    const straddling = layout.nodes.filter((n) => (
      Math.floor(n.x / HIT_CELL) !== Math.floor((n.x + NODE_W) / HIT_CELL)
      || Math.floor(n.y / HIT_CELL) !== Math.floor((n.y + NODE_H) / HIT_CELL)));
    assert.ok(straddling.length > 0, 'the fixture must contain cards that cross a bucket edge');

    const missed = [];
    for (const node of layout.nodes) {
      for (const [where, x, y] of pointsOn(node)) {
        const found = nodeAtPoint(index, layout.metrics, x, y)?.id ?? null;
        if (found !== node.id) missed.push(`${node.id} ${where} -> ${found}`);
      }
    }
    assert.deepStrictEqual(missed, [], `${missed.length} points missed their own card`);
  });
}
