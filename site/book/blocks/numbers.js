/*
 * The family in numbers.
 *
 * The page people talk about, so every figure on it is counted from the record, never estimated,
 * and none of it can tell a stranger how old a living person is. It opens with the family as a
 * star chart laid on time - across is the year somebody was born, down is their generation - which
 * shows at a glance what a list cannot: how the generations overlap.
 */

import { PAGE, path, circle, rect, PathData } from '../format.js';
import { starfield, sparkleData } from './art.js';
import { sky } from './cover.js';
import { countWords, andList } from './words.js';

const { w: W, h: H } = PAGE;

export function numbersPage(ctx) {
  const { family, facts, P } = ctx;
  const panel = 400;
  const items = [
    rect(0, 0, W, panel, { fill: sky(ctx) }),
    starfield(`${family.title} numbers`, 90, { x: 0, y: 0, w: W, h: panel }, P.star),
    ctx.line(44, 72, 'The family in numbers', 'display', 30, P.star),
  ];

  const born = family.people.filter((p) => p.by !== null && p.gen !== null);
  if (born.length >= 2) {
    const x0 = 60, x1 = W - 44, y0 = 124, y1 = 346;
    const first = Math.floor(Math.min(...born.map((p) => p.by)) / 10) * 10;
    const last = Math.max(Math.ceil((Math.max(...born.map((p) => p.by)) + 1) / 10) * 10, first + 20);
    const X = (yr) => x0 + ((yr - first) / (last - first)) * (x1 - x0);
    const Y = (g) => (family.generations <= 1 ? (y0 + y1) / 2 : y0 + (g / (family.generations - 1)) * (y1 - y0));
    const grid = new PathData();
    const labelEvery = last - first > 80 ? 20 : 10;
    for (let yr = first; yr <= last; yr += 10) {
      grid.M(X(yr), y0 - 12).L(X(yr), y1 + 10);
      if ((yr - first) % labelEvery === 0) items.push(ctx.line(X(yr), y1 + 26, String(yr), 'text', 8, P.mist, { align: 'middle' }));
    }
    items.push(path(String(grid), { stroke: P.mist, sw: 0.4, op: 0.3 }));
    const at = new Map(born.map((p) => [p.id, [X(p.by), Y(p.gen)]]));
    const lines = new PathData();
    for (const p of born) for (const parent of family.parentsOf(p.id)) {
      const a = at.get(parent.id);
      if (a) lines.M(...a).L(...at.get(p.id));
    }
    if (!lines.empty) items.push(path(String(lines), { stroke: P.gold, sw: 0.6, op: 0.5 }));
    const stars = new PathData();
    for (const p of born) {
      const [x, y] = at.get(p.id);
      if (p.deceased) items.push(circle(x, y, 2.6, { fill: P.gold }));
      else sparkleData(x, y, 5, stars);
    }
    if (!stars.empty) items.push(path(String(stars), { fill: P.star }));
    items.push(ctx.line(W - 44, panel - 10, 'Every birth on record, by year and by generation.', 'text', 9, P.mist, { align: 'end' }));
  }

  const figures = factsFor(facts);
  const col = (W - 88 - 32) / 2;
  figures.forEach(({ big, small, accent, kind }, i) => {
    const x = 44 + (i % 2) * (col + 32), y = panel + 76 + Math.floor(i / 2) * 104;
    const size = ctx.fit(big, 'display', 40, col, 22);
    items.push(ctx.line(x, y, big, 'display', size, accent ? P.goldSoft : P.ink, { kind }));
    items.push(...ctx.lines(x, y + 24, small, 'text', 11.5, P.inkSoft, { width: col - 10, maxLines: 3, lead: 15 }).items);
  });
  items.push(...ctx.footer(P.inkSoft));
  return ctx.page('The family in numbers', items, P.paper);
}

/** Up to six figures, most telling first. Each is left out when the record cannot support it. */
export function factsFor(facts) {
  const out = [];
  out.push({ big: String(facts.people), small: facts.generations > 1 ? `people in ${countWords(facts.generations)} generations` : facts.people === 1 ? 'person in this book' : 'people in this book' });
  if (facts.earliest) out.push({ big: String(facts.earliest), small: 'the earliest year anyone recorded' });
  // `lifespan`: a departed person's recorded life, the one "N years" a book may print (#245 checks).
  if (facts.longest) out.push({ big: `${facts.longest.years} years`, small: `the longest life on record, ${facts.longest.name}'s`, kind: 'lifespan' });
  if (facts.largest) {
    const who = facts.largest.raisedBy.length ? `, raised by ${andList(facts.largest.raisedBy)}` : '';
    out.push({ big: String(facts.largest.children), small: `children in the largest family${who}` });
  }
  if (facts.couples) out.push({ big: String(facts.couples), small: facts.couples === 1 ? 'marriage in the family' : 'marriages in the family' });
  if (facts.repeated) out.push({ big: String(facts.repeated.n), small: `people named ${facts.repeated.name}, in more than one generation` });
  if (facts.unknown) {
    const line = facts.unknown === 1 ? 'person whose name is still waiting to be found' : 'people whose names are still waiting to be found';
    // The invitation belongs last, and in gold: it is the one figure a reader can change.
    const kept = out.slice(0, 5);
    kept.push({ big: String(facts.unknown), small: line, accent: true });
    return kept;
  }
  return out.slice(0, 6);
}
