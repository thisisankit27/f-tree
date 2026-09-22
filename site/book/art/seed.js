/*
 * The one source of chance the art may use: a small, fast, seeded generator (mulberry32), the
 * same on every engine, so the same family always gets the same wobble and scatter.
 *
 * Seed it with the chapter and person ids, never the page number (art/README.md, rule 6), so an
 * unrelated edit elsewhere in the book doesn't reshuffle a picture. Moved here from
 * blocks/art.js (#247), which re-exports it unchanged.
 */

/** A generator of numbers in [0, 1) from any string seed. */
export function seeded(seed) {
  let a = 7;
  for (const ch of String(seed)) a = Math.imul(a ^ ch.codePointAt(0), 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
