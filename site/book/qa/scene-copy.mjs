/*
 * The copy each scene (#254) must hold in its text zones, and a way to set it there.
 *
 * #252's sentences are not written yet, so the lengths are the approved style frames' own copy
 * (site/book/art/style-frames/frames.mjs), and where a chapter's sentence will be longer than a
 * frame showed, the plan's example sentence for it (docs/storybook-plan.md, "Story sequence").
 * The type sizes are the design system's (docs/book-design-system.md, "Typography" and "Density").
 * art-scenes.test.mjs holds every scene to setting all of it without a truncated or overflowing
 * line; tools/book_scene_review.mjs sets it on the review renders. When #252 lands, its longest
 * typical sentence for each chapter belongs here.
 *
 * Not composer code: pages set their own copy. This only measures.
 */

import { breakLines, measure } from '../text.js';

/** A body sentence at the design system's story setting, 13/19 in `text`. */
const body = (s, fill = 'ink') => ({ s, font: 'book_text', size: 13, lead: 19, fill });
const hand = (s, size, fill) => ({ s, font: 'book_hand', size, lead: size * 1.4, fill });
const display = (s, size, fill) => ({ s, font: 'book_display', size, lead: size * 1.25, fill, lines: 1 });

/** Scene id -> zone name -> the blocks set in it, top to bottom, centred. */
export const SAMPLE_COPY = {
  'ghat-night': {
    title: [display('शुभ दीपावली', 58, 'gold'), display('from the Kumar family', 34, 'card'), hand('Twenty-three lamps, one for each of us.', 17, 'flame')],
    credit: [{ s: 'Made with f-tree', font: 'book_text', size: 7.5, lead: 10, fill: 'card', align: 'start' }],
  },
  banyan: {
    title: [display('Our roots', 36, 'ink'), hand('Five generations before Ankit', 15, 'inkSoft')],
    story: [body('The oldest names we know are Shyam Lal and his wife, who lived in Varanasi before 1930. Every branch of this family grows from their courtyard, and the roots still hold.')],
  },
  aangan: {
    title: [display('Two courtyards', 36, 'ink'), hand('Where Vinod and Anita grew up', 15, 'inkSoft')],
    left: [{ ...body('Father’s side. Vinod grew up here, and Meena was born to Raj Kumar and Kamla Devi (1948 – 2019).'), size: 11, lead: 16 }],
    right: [{ ...body('Mother’s side. Two lamps are kept in the wall of this house, one for each of them, until someone remembers.'), size: 11, lead: 16 }],
  },
  'haveli-lane': {
    title: [display('Our lane', 38, 'ink'), hand('Ankit’s wider family, door by door', 15, 'inkSoft')],
    footer: [hand('Every door on this lane opens to family.', 16, 'ink')],
  },
  'remembrance-night': {
    title: [display('Still to be found', 36, 'card'), hand('Two names in our family are waiting to be remembered.', 15, 'flame')],
    closing: [hand('Some names are missing, but they are not forgotten. A lamp is kept for each of them, until someone remembers.', 15, 'flame'), { ...body('Perhaps someone reading this remembers.', 'card'), size: 10.5, lead: 16 }],
  },
  'closing-sky': {
    title: [display('Happy Diwali', 44, 'gold'), hand('from all of us, to all of you', 17, 'flame')],
    missing: [display('Is someone missing?', 22, 'card'), body('If you know a name, a date or a face that belongs in this book, tell us. The family grows every time someone remembers.', 'card')],
    credit: [{ s: 'Made with f-tree', font: 'book_text', size: 7.5, lead: 10, fill: 'card', align: 'start' }],
  },
};

/**
 * Sets `copy` (zone name -> blocks) in the named zones, centred unless a block says otherwise.
 * Returns `{ items, problems }`: `items` are `{ x, y, s, font, size, fill, align }` baselines, and
 * `problems` names every zone that is missing, every block that needs more lines than it may
 * have, and every zone whose copy runs out of its box.
 */
export function layoutCopy(copy, zones, metrics) {
  const items = [], problems = [];
  for (const [name, blocks] of Object.entries(copy)) {
    const z = zones.find((q) => q.kind === 'text' && q.name === name);
    if (!z) { problems.push(`no text zone named "${name}"`); continue; }
    let y = z.y;
    for (const b of blocks) {
      const lines = breakLines(b.s, metrics[b.font], b.size, z.w);
      if (b.lines !== undefined && lines.length > b.lines) problems.push(`${name}: "${b.s}" needs ${lines.length} lines at ${b.size} pt in ${z.w} pt, and may have ${b.lines}`);
      lines.forEach((l) => {
        if (measure(l, metrics[b.font], b.size) > z.w + 0.01) problems.push(`${name}: "${l}" is wider than the zone`);
        y += b.lead;
        const align = b.align ?? 'middle';
        items.push({ x: align === 'middle' ? z.x + z.w / 2 : z.x, y: y - (b.lead - b.size) / 2 - b.size * 0.2, s: l, font: b.font, size: b.size, fill: b.fill, align });
      });
    }
    if (y > z.y + z.h + 0.01) problems.push(`${name}: the copy needs ${Math.round(y - z.y)} pt and the zone is ${z.h} pt tall`);
  }
  return { items, problems };
}

export const setCopy = (copy, zones, metrics) => layoutCopy(copy, zones, metrics).items;
