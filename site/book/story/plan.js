/*
 * The story planner (#251): the featured person's circles (`kin.js`) in, the book's pages out.
 *
 * Every decision about *which* pages the storybook has is made here, once, before anything is
 * drawn: what each page holds, in what order, when a chapter splits or merges, and every page's
 * number. The archetypes (#256-#258) only draw the `PagePlan` they are handed; none of them may
 * split a page further or drop one, or the register's page references (#258) would point at the
 * wrong page. That is why page numbers are assigned here, in a single pass, after every other
 * decision is final.
 *
 * ## Chapters
 *
 * A format-2 template lists its chapters (`story.chapters`, template.js). The ids a template may
 * use are `CHAPTERS`, which includes template.js's `REQUIRED_CHAPTERS`; an id the planner does not
 * know is refused by name, never skipped. Each family chapter is drawn from kin.js's circles
 * (`MEMBERS`), and anybody no chapter shows is in the register, which lists everyone in scope.
 *
 * ## Rules (docs/storybook-plan.md, "Story sequence"; docs/book-design-system.md, "Density")
 *
 *   - **Empty chapters are skipped.** A chapter listed in the template but with nobody to show
 *     (no spouse, no known grandparents) has no page.
 *   - **Splitting** balances pages: a chapter of n entries over a cap of c takes ceil(n / c) pages
 *     whose sizes differ by at most one, the larger ones last. With every cap >= 5 (checked
 *     below), a continuation page always holds at least `MIN_CONTINUATION` (3) entries: n > c
 *     means each of k >= 2 pages holds at least floor(n / k) >= floor((c + 1) / 2) >= 3.
 *   - **Merging:** consecutive family chapters that each have fewer than `MIN_CONTINUATION`
 *     people share one "household" page rather than each shipping a near-empty one. A lone small
 *     chapter keeps its own page: parents to children draw it as a portrait hero (1-2 people is a
 *     hero page), roots and courtyards as their own small gathering.
 *   - **Variety:** a page takes the first variant of its archetype whose (archetype, variant)
 *     differs from the previous page's - the design system's "no two consecutive pages share both a
 *     composition and an art placement". Every archetype has at least two variants, so this always
 *     succeeds.
 *   - **The cap:** at most `MAX_STORY_PAGES` pages that are not the register. Every chapter keeps
 *     its first page; the pages beyond that are granted in `EXTRA_PAGE_PRIORITY` order until the
 *     cap is reached. Everyone on a page that did not make it is in the register (`registerOnly`),
 *     never dropped.
 *   - **Family shape**, all read off the data:
 *       - eldest: F has no parents, grandparents or ancestors on record, so there are no roots,
 *         courtyards or parents pages; the opening says so (`folds`), and the family chapters flow
 *         downward - spouses and children before siblings;
 *       - child: F has no spouse, child or descendant, so those chapters are skipped;
 *       - tiny (at most `TINY` people in scope): every family chapter shares one household page and
 *         there is no numbers page, which leaves 5-7 pages;
 *       - empty (nobody to feature): a cover, a "waiting for its family" page and the closing,
 *         with the register before the closing when the tree has people but none with a name.
 *
 * ## What it returns: `planStory(kin, template, family, options)`
 *
 *   {
 *     featured,               // kin.featured
 *     shape: { empty, tiny, eldest, child, unlinked },
 *     pages: PagePlan[],      // in book order; pages[i].pageNo === i + 1
 *     pagesOf: Map<id, number[]>,   // the story pages (not the register) each person is on
 *     registerOnly: id[],     // people in scope on no story page, in register order
 *   }
 *
 *   PagePlan {
 *     pageNo,      // 1-based, final
 *     chapter,     // the chapter id the page belongs to (the first, for a household page)
 *     chapters,    // every chapter on the page: one, or several on a household page
 *     copyKey,     // the template `copy` entry the page's words come from (#252): its chapter
 *     archetype, variant,   // what draws it, and which art placement (ctx.describePage)
 *     density,     // the design system's density row, or null for a page without people
 *     people,      // ids, in the order the page shows them
 *     groups,      // [{ key, people }]: households, houses on a lane page, register sections
 *     continued,   // true on a chapter's second and later pages
 *     folds,       // on the opening only: the chapters folded into it (eldest F), else []
 *   }
 *
 * Deterministic: it reads nothing but its arguments, and every order comes from kin.js, which
 * sorts by the record's ids and dates, never by the order a file listed things in.
 */

import { REQUIRED_CHAPTERS } from '../template.js';

/** Every chapter id a format-2 template may list, in the story's own order. */
export const CHAPTERS = Object.freeze([
  'cover', 'opening', 'roots', 'courtyards', 'parents', 'siblings', 'spouses', 'children',
  'lane', 'numbers', 'register', 'still-to-be-found', 'legacy', 'closing',
]);

/**
 * Chapters a person's note (`options.notes`) never appears on: the register lists everyone by
 * name alone (storybook-plan.md, "Notes"). The one table `copy.js`'s `noteCaption` reads, so the
 * rule lives here rather than as a chapter-id string copy.js compares against on its own.
 */
export const NO_NOTES = Object.freeze(new Set(['register']));

/** About 28 story pages; everyone beyond them is in the register (docs/storybook-plan.md). */
export const MAX_STORY_PAGES = 28;
/** A continuation page never holds fewer entries than this, and a chapter below it may merge. */
export const MIN_CONTINUATION = 3;
/** At most this many people in scope is a tiny family: 5-7 pages. */
export const TINY = 5;

/** The design system's density rows (book-design-system.md, "Density"). */
export const DENSITY = Object.freeze({ hero: 2, family: 8, gathering: 12, house: 8, houses: 4, register: 48 });

/** The chapters whose people come from kin.js's circles, and which circle entries each takes. */
const MEMBERS = {
  roots: (e) => e.circle === 'ancestors',
  courtyards: (e) => e.circle === 'grandparents',
  parents: (e) => e.circle === 'parents' || e.role === 'aunt-uncle' || e.role === 'parent-spouse',
  siblings: (e) => e.circle === 'siblings' || e.role === 'sibling-spouse',
  spouses: (e) => e.circle === 'spouses' || ['spouse-parent', 'spouse-sibling', 'spouse-child'].includes(e.role),
  children: (e) => e.circle === 'children' || e.circle === 'descendants' || e.role === 'child-spouse',
  lane: (e) => e.circle === 'branches' || e.circle === 'lane',
};
/** Family chapters drawn as a gathering of households; small ones merge. */
const HOUSEHOLD_CHAPTERS = new Set(['roots', 'courtyards', 'parents', 'siblings', 'spouses', 'children']);
/** The chapters that show nobody but F, or nobody at all. */
const SINGLE_PAGE = new Set(['cover', 'opening', 'numbers', 'legacy', 'closing']);

/** Which chapters get pages beyond their first, first come first served, while the cap allows. */
const EXTRA_PAGE_PRIORITY = ['parents', 'courtyards', 'siblings', 'spouses', 'children', 'roots', 'still-to-be-found', 'lane'];

/** Each archetype's art placements, tried in order by the variety rule. Two at least, always. */
export const VARIANTS = Object.freeze({
  cover: ['ghat', 'ghat-mirrored'],
  'opening-hero': ['arch', 'window'],
  waiting: ['arch', 'window'],
  'portrait-hero': ['arch', 'niche'],
  gathering: ['band', 'doorways', 'steps'],
  banyan: ['roots', 'canopy'],
  courtyards: ['facing', 'mirrored'],
  lane: ['lane', 'lane-mirrored'],
  numbers: ['vignettes', 'vignettes-mirrored'],
  register: ['columns', 'columns-mirrored'],
  'still-to-be-found': ['lamps', 'lamps-mirrored'],
  legacy: ['line', 'line-mirrored'],
  closing: ['sky', 'sky-mirrored'],
});

for (const c of REQUIRED_CHAPTERS) if (!CHAPTERS.includes(c)) throw new Error(`plan.js: required chapter "${c}" is not in CHAPTERS`);
for (const [k, cap] of Object.entries(DENSITY)) {
  if (k !== 'houses' && k !== 'hero' && cap < 2 * MIN_CONTINUATION - 1) throw new Error(`plan.js: a ${k} cap of ${cap} could leave a continuation page under ${MIN_CONTINUATION}`);
}

/**
 * `items` in ceil(n / cap) runs of balanced size, in order, the larger runs last - so a
 * continuation run is never smaller than the first. One run when n <= cap; none when n is 0.
 */
export function splitBalanced(items, cap) {
  const n = items.length;
  if (!n) return [];
  const k = Math.ceil(n / cap);
  const small = Math.floor(n / k);
  const big = n % k;   // the last `big` runs take one more
  const out = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const size = small + (i >= k - big ? 1 : 0);
    out.push(items.slice(at, at + size));
    at += size;
  }
  return out;
}

/** Consecutive ids that share a key, as [{ key, people }], in order. */
function groupBy(ids, keyOf) {
  const out = [];
  for (const id of ids) {
    const key = keyOf(id);
    if (out.length && out[out.length - 1].key === key) out[out.length - 1].people.push(id);
    else out.push({ key, people: [id] });
  }
  return out;
}

/** Only those `groups` members that are in `ids`, dropping any group left empty. */
const regroup = (groups, ids) => {
  const on = new Set(ids);
  return groups.map((g) => ({ key: g.key, people: g.people.filter((id) => on.has(id)) })).filter((g) => g.people.length);
};

/**
 * @param kin      `kinOf(family, featured)`'s result
 * @param template a validated format-2 template (`validateTemplate`)
 * @param family   `readFamily`'s result, for who has a recorded name
 * @param options  { maxStoryPages } - the cap, for tests only
 */
export function planStory(kin, template, family, options = {}) {
  const cap = options.maxStoryPages ?? MAX_STORY_PAGES;
  const listed = template.story.chapters;
  for (const c of listed) {
    if (!CHAPTERS.includes(c)) throw new Error(`the story planner does not know the chapter "${c}" in template "${template.id}" - use one of ${CHAPTERS.join(', ')}`);
  }

  const F = kin.featured;
  const everyone = [...kin.people.keys()];   // circle order: the register's order
  const entry = (id) => kin.people.get(id);
  const empty = (circle) => !kin.circles[circle]?.length;
  const shape = {
    empty: F === null,
    tiny: F !== null && everyone.length <= TINY,
    eldest: F !== null && empty('parents') && empty('grandparents') && empty('ancestors'),
    child: F !== null && empty('spouses') && empty('children') && empty('descendants'),
    unlinked: F !== null && everyone.every((id) => id === F || entry(id).circle === 'elsewhere'),
  };

  // The book with nobody to feature: a cover, a page waiting for its family, the closing - and,
  // when the tree has people but none with a name to feature (resolveFeatured's last resort),
  // the register between them, because everyone in scope still appears somewhere.
  if (shape.empty) {
    const register = everyone.length ? registerPages(everyone, entry) : [];
    const pages = finish([
      page('cover', 'cover', []),
      page('opening', 'waiting', []),
      ...register.map((pg, i) => page('register', 'register', pg.people, { groups: pg.groups, continued: i > 0, density: 'register' })),
      page('closing', 'closing', []),
    ].filter((p) => listed.includes(p.chapter)));
    return Object.freeze({ featured: null, shape: Object.freeze(shape), pages, pagesOf: new Map(), registerOnly: Object.freeze(everyone) });
  }

  // Chapter order: the template's, except that an eldest F's story flows downward.
  let order = [...listed];
  if (shape.eldest) {
    const down = ['spouses', 'children', 'siblings'].filter((c) => order.includes(c));
    const slots = order.map((c, i) => (down.includes(c) ? i : -1)).filter((i) => i >= 0);
    slots.forEach((slot, i) => { order[slot] = down[i]; });
  }

  // Who each family chapter shows, and how they group: a household is one kin branch.
  const groupKey = (id) => `${entry(id).circle}:${entry(id).branch ?? ''}`;
  const membersOf = (chapter) => {
    if (chapter === 'still-to-be-found') return everyone.filter((id) => id !== F && entry(id).circle !== 'elsewhere' && !family.byId.get(id)?.name);
    const take = MEMBERS[chapter];
    return take ? everyone.filter((id) => take(entry(id))) : [];
  };

  // Chapter plans: each chapter's pages before the cap, as { chapter, pages: [{people, groups}] }.
  const chapters = [];
  for (const chapter of order) {
    if (chapter === 'numbers' && shape.tiny) continue;   // a family of five has nothing to count
    if (SINGLE_PAGE.has(chapter)) { chapters.push({ chapter, kind: chapter }); continue; }
    if (chapter === 'register') { chapters.push({ chapter, kind: 'register', pages: registerPages(everyone, entry) }); continue; }
    const people = membersOf(chapter);
    if (!people.length) continue;
    const groups = groupBy(people, groupKey);
    if (chapter === 'lane') { chapters.push({ chapter, kind: 'lane', pages: lanePages(groups) }); continue; }
    const density = chapter === 'roots' || chapter === 'courtyards' || chapter === 'still-to-be-found' ? 'gathering' : 'family';
    chapters.push({
      chapter,
      kind: chapter,
      small: HOUSEHOLD_CHAPTERS.has(chapter) && (shape.tiny || people.length < MIN_CONTINUATION),
      pages: splitBalanced(people, DENSITY[density]).map((ids) => ({ people: ids, groups: regroup(groups, ids) })),
    });
  }

  // Merge runs of small household chapters into one page (or, past a family page's cap, a few).
  const merged = [];
  for (let i = 0; i < chapters.length;) {
    let j = i;
    while (j < chapters.length && chapters[j].small) j++;
    if (j - i >= 2) {
      const run = chapters.slice(i, j);
      const people = run.flatMap((c) => c.pages.flatMap((p) => p.people));
      const groups = run.flatMap((c) => c.pages.flatMap((p) => p.groups));
      merged.push({
        chapter: run[0].chapter, chapters: run.map((c) => c.chapter), kind: 'household',
        pages: splitBalanced(people, DENSITY.family).map((ids) => ({ people: ids, groups: regroup(groups, ids) })),
      });
      i = j;
    } else {
      merged.push(chapters[i]);
      i++;
    }
  }

  // The cap: every chapter keeps its first page, and a household all of its pages (a run of small
  // chapters is under 3 people a chapter, so at most three pages); extra pages go by priority while
  // room is left. The register is not a story page and is never trimmed.
  const fixed = (c) => (c.kind === 'household' || c.kind === 'register' ? c.pages.length : 1);
  const keep = new Map(merged.map((c) => [c, fixed(c)]));
  let room = cap - merged.reduce((n, c) => n + (c.kind === 'register' ? 0 : fixed(c)), 0);
  for (const name of EXTRA_PAGE_PRIORITY) {
    for (const c of merged) {
      if (c.chapter !== name || c.kind === 'household' || !c.pages) continue;
      const extra = Math.max(0, Math.min(c.pages.length - 1, room));
      keep.set(c, 1 + extra);
      room -= extra;
    }
  }

  // PagePlans, in book order.
  const plans = [];
  for (const c of merged) {
    const chapters = c.chapters ?? [c.chapter];
    if (!c.pages) {
      const who = c.chapter === 'opening' || c.chapter === 'legacy' ? [F] : [];
      const p = page(c.chapter, archetypeOf(c.kind, 1), who, { chapters, density: who.length ? 'hero' : null, groups: who.length ? [{ key: 'self:', people: who }] : [] });
      if (c.chapter === 'opening' && shape.eldest) p.folds = ['roots', 'courtyards'].filter((x) => listed.includes(x));
      plans.push(p);
      continue;
    }
    c.pages.slice(0, keep.get(c)).forEach((pg, i) => {
      const archetype = archetypeOf(c.kind, pg.people.length);
      plans.push(page(c.chapter, archetype, pg.people, {
        chapters, groups: pg.groups, continued: i > 0,
        density: DENSITY_OF[archetype] ?? null,
      }));
    });
  }
  const pages = finish(plans);

  const pagesOf = new Map();
  for (const p of pages) {
    if (p.archetype === 'register') continue;
    for (const id of p.people) {
      if (!pagesOf.has(id)) pagesOf.set(id, []);
      if (!pagesOf.get(id).includes(p.pageNo)) pagesOf.get(id).push(p.pageNo);
    }
  }
  for (const list of pagesOf.values()) Object.freeze(list);
  const registerOnly = Object.freeze(everyone.filter((id) => !pagesOf.has(id)));
  return Object.freeze({ featured: F, shape: Object.freeze(shape), pages, pagesOf, registerOnly });
}

/** What draws a page of this kind, holding this many people. */
function archetypeOf(kind, n) {
  switch (kind) {
    case 'cover': return 'cover';
    case 'opening': return 'opening-hero';
    case 'roots': return 'banyan';
    case 'courtyards': return 'courtyards';
    case 'lane': return 'lane';
    case 'numbers': return 'numbers';
    case 'register': return 'register';
    case 'still-to-be-found': return 'still-to-be-found';
    case 'legacy': return 'legacy';
    case 'closing': return 'closing';
    default: return n <= DENSITY.hero ? 'portrait-hero' : 'gathering';   // parents...children, household
  }
}

const DENSITY_OF = { 'portrait-hero': 'hero', gathering: 'family', banyan: 'gathering', courtyards: 'gathering', 'still-to-be-found': 'gathering', lane: 'lane', register: 'register' };

function page(chapter, archetype, people, extra = {}) {
  return { chapter, chapters: [chapter], copyKey: chapter, archetype, variant: null, density: null, people: [...people], groups: [], continued: false, folds: [], ...extra };
}

/** The single pass that makes a plan final: variety, then page numbers, then freezing. */
function finish(plans) {
  let prev = null;
  return Object.freeze(plans.map((p, i) => {
    p.variant = VARIANTS[p.archetype].find((v) => !(prev && prev.archetype === p.archetype && prev.variant === v));
    p.pageNo = i + 1;
    prev = p;
    p.groups = Object.freeze(p.groups.map((g) => Object.freeze({ key: g.key, people: Object.freeze([...g.people]) })));
    for (const k of ['chapters', 'people', 'folds']) p[k] = Object.freeze(p[k]);
    return Object.freeze(p);
  }));
}

/**
 * The lane: one house per kin branch (an aunt's or uncle's family, or a wider line), at most
 * `DENSITY.house` names a house - a larger branch takes several houses, balanced - and at most
 * `DENSITY.houses` houses a page, balanced the same way with the fuller pages last. A lane page's
 * continuation therefore holds at least ceil(h / k) >= 3 houses, so at least 3 names.
 */
function lanePages(groups) {
  const houses = groups.flatMap((g) => splitBalanced(g.people, DENSITY.house).map((people) => ({ key: g.key, people })));
  return splitBalanced(houses, DENSITY.houses).map((hs) => ({ people: hs.flatMap((h) => h.people), groups: hs }));
}

/**
 * The register: everyone in scope, in kin.js's circle order, one section per circle ('elsewhere',
 * the people not linked to F, is its own section, last). A page holds `DENSITY.register` rows, and
 * each section that starts or continues on it costs one of them for its heading. A last page left
 * with fewer than MIN_CONTINUATION people takes some from the page before it.
 */
function registerPages(everyone, entry) {
  const sections = groupBy(everyone, (id) => entry(id).circle);
  const pages = [];
  let cur = null;
  let rows = 0;
  for (const s of sections) {
    for (const id of s.people) {
      let opens = !cur || cur.groups[cur.groups.length - 1].key !== s.key;
      if (!cur || rows + (opens ? 2 : 1) > DENSITY.register) {
        cur = { people: [], groups: [] };
        pages.push(cur);
        rows = 0;
        opens = true;
      }
      if (opens) {
        cur.groups.push({ key: s.key, people: [] });
        rows++;
      }
      cur.groups[cur.groups.length - 1].people.push(id);
      cur.people.push(id);
      rows++;
    }
  }
  const last = pages[pages.length - 1];
  if (pages.length >= 2 && last.people.length < MIN_CONTINUATION) {
    const before = pages[pages.length - 2];
    const all = [...before.people, ...last.people];
    const cut = all.length - MIN_CONTINUATION;
    const keyOf = (id) => entry(id).circle;
    const refill = (ids) => ({ people: ids, groups: groupBy(ids, keyOf) });
    pages.splice(pages.length - 2, 2, refill(all.slice(0, cut)), refill(all.slice(cut)));
  }
  return pages;
}
