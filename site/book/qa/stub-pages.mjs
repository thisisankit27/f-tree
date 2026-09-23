/*
 * Stand-in page archetypes, so one issue's pages can be composed and looked at before the other
 * issues' pages exist.
 *
 * The storybook's archetypes are built by three issues at once (#256-#258), and a book needs all
 * of them: the register is required of every template, so no one issue can compose a whole book on
 * its own. These draw a plain, ugly page - the chapter, the archetype, the variant and whoever the
 * page is about - for every archetype `plan.js` can ask for. An issue renders its own pages beside
 * them (`composeWithPages(doc, options, tpl, withStubs(PAGES))`), and its real pages replace the
 * stubs as they land.
 *
 * Test-only. It is not in `compose.js`'s import closure, nothing a shell calls reaches it, and it
 * is deliberately unlovely: a stub that looked finished would be mistaken for one.
 */

import { VARIANTS } from '../story/plan.js';
import { PAGES } from '../story/pages/index.js';
import { nameOf } from '../story/copy.js';

const MARGIN = 42;

/** A page that says what would be drawn here, and lists who it is about. */
const stub = (archetype) => (ctx, page, story) => {
  ctx.describePage({ archetype: page.archetype, variant: page.variant, people: page.people, density: page.density });
  const items = [
    ctx.line(MARGIN, 90, `${page.chapters.join(' + ')}${page.continued ? ' (continued)' : ''}`, 'display', 26, ctx.P.ink, { kind: 'title' }),
    ctx.line(MARGIN, 116, `stub: ${archetype} / ${page.variant}`, 'text', 11, ctx.P.inkSoft, { kind: 'body' }),
  ];
  let y = 150;
  for (const id of page.people) {
    ctx.show(id);
    if (y > 780) break;
    items.push(ctx.line(MARGIN, y, nameOf(ctx.family, story.kin, id) ?? id, 'strong', 10.5, ctx.P.ink, { kind: 'name' }));
    y += 14;
  }
  items.push(...ctx.footer(ctx.P.inkSoft));
  return ctx.page(`${page.chapter} (stub)`, items, ctx.P.paper);
};

/** Every archetype the planner can ask for, drawn as a stub. */
export const STUB_PAGES = Object.freeze(Object.fromEntries(Object.keys(VARIANTS).map((a) => [a, stub(a)])));

/** The real archetypes where they exist, stubs everywhere else. */
export const withStubs = (pages = PAGES) => ({ ...STUB_PAGES, ...pages });
