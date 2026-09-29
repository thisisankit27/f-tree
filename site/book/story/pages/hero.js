/*
 * Hero pages (#256): the cover, the opening, a page waiting for its family, a portrait hero, and
 * the closing. One person or none, one moment on a scene: the pages that carry the most weight,
 * because the cover is the chat thumbnail and the opening is the reader's first look at F.
 *
 * `pages/index.js` holds the contract every archetype keeps (`describePage`, `show`, `line`'s
 * `kind`, `zone`). What is particular to these five:
 *
 *   - **The cover counts.** One lamp for each person in scope and not one more, through
 *     `diyaRow` (#255), laid in as many rows as it takes for the lamps not to overlap. It is the
 *     one page that must read at 150 px wide, so its words are set big and its art is the picture
 *     behind them, never over them.
 *   - **The cover is the family's, not the featured person's** (docs/storybook-plan.md's decision
 *     table): it names nobody, and it reports nobody as shown. The register is what promises that
 *     everyone appears.
 *   - **The opening is the reader's first look at F**, at an arch window: their photograph, or -
 *     with none - the figure seen from behind, looking at the view. Its words are `copy.js`'s:
 *     the template's own title, and the composed `openingLine`.
 *   - **The waiting page** is a book with nobody to feature: an arch with a lamp lit in it and
 *     nobody at the window, and an invitation in the app's own words.
 *   - **A portrait hero** is one or two people who need the room - a chapter with too few for a
 *     gathering - with as little text as says who they are.
 *   - **The closing** is the acquisition loop: a new-moon sky, "Is someone missing?", the QR code
 *     that opens the website, and the quiet footer.
 *
 * Composer code: deterministic, no clock, no locale, no DOM, no Math.random, static relative
 * imports only.
 */

import { PAGE, PathData, circle, path, rect, group } from '../../format.js';
import { SITE_QR } from '../../qr.js';
import { qrPath } from '../../blocks/art.js';
import { diyaRow, rangoli, toran } from '../../art/procedural/index.js';
import { seeded } from '../../art/seed.js';
import { chapterCopy, pageVars, chapterVars, fillPlaceholders, kinCaption, nameOf, noteCaption, openingLine, pickLine, withCountWords } from '../copy.js';
import { SAFE, folio, glowDiscs, midX, noteCard, paperGround, sanjhiBand, scene, scenePlacement, tailpiece, titleBlock } from './parts/page.js';
import { MALA_DROP, frameOuter, framedPerson, joinFrames, nameStack, openingIn, yearsCaption } from './parts/people.js';
import { haveliFacade } from './parts/haveli.js';
import { describePage as describe } from './parts/describe.js';

const { w: W, h: H } = PAGE;

/* ------------------------------------------------------------------ the cover */

/**
 * How the cover's lamps are laid out. One lamp is one person, so the only thing a big family
 * changes is how the lamps are arranged: more rows, further off, each lamp smaller, exactly as the
 * approved frame draws the river receding. The rows never take a lamp away and never add one.
 */
const MAX_LAMP_ROWS = 12;
const NEAR_LAMP = 26;   // pt wide, the nearest row
const FAR_LAMP = 12;    // pt wide, the furthest
/** A lamp narrower than this stops reading as a lamp. `pages-hero.test.mjs` holds the rows to it. */
export const MIN_LAMP = 5;
/** How wide the furthest row runs, as a fraction of the lamps zone: the river bends away. */
const FAR_SPREAD = 0.62;
/*
 * A lamp keeps its own glow while it is near enough for the glow to read. Further off it is drawn
 * as `diya-small`, the same lamp without the glow discs: `ghat-night` already lays one warm glow
 * over the whole lamps zone, "whatever their number" (tools/book_scenes.mjs), so a small lamp's own
 * discs would only add cost. That cost is the reason the rule is here rather than left to taste - a
 * glowing lamp is about 17 KB of estimated PDF and a small one about 7.5 (compose.js's `ART_PDF`),
 * and a two-hundred-person cover lights two hundred of them.
 */
const GLOWS_ABOVE = 16;
const GLOW_ZONE_FROM = 40;   // lamps, below which the field lights itself and a zone disc only greys it

/**
 * How many rows of lamps `n` people take. It grows as the square root of the count, which is what
 * keeps a row's lamps standing side by side rather than on top of one another as the family grows:
 * both the number of rows and the lamps on each grow with sqrt(n), so the spacing along a row
 * shrinks with sqrt(n) rather than with n. `pages-hero.test.mjs` holds the result to the design
 * system's own bar - no lamp overlapping its neighbour, and none narrower than `MIN_LAMP` - for
 * families up to twice the largest the planner is built for.
 *
 * A family too large for even `MAX_LAMP_ROWS` rows at that size gets the largest lamps its rows
 * allow, and every one of them: the one thing the cover may never do is leave somebody unlit,
 * which is what a cap here would mean.
 */
const LAMPS_A_ROW = 2.6;
const rowsFor = (n) => Math.max(1, Math.min(MAX_LAMP_ROWS, Math.round(Math.sqrt(n / LAMPS_A_ROW))));

/**
 * Rows of lamps for `n` people: one lamp each, none of them on top of another.
 *
 * Round 2 (finding 4): the rows used to sit at dead-even y-steps with a flat baseline each, which
 * read as a textile swatch rather than a river. A small seeded offset on each row's own centre
 * keeps them from stacking in perfectly even bands, and a seeded tilt between a row's two ends -
 * carried through to `diyaRow`'s own `(x1,y1)`-`(x2,y2)` endpoints in `lamps` below - bends the
 * baseline itself, on top of `diyaRow`'s own per-lamp jitter. `boat` marks the near rows, which
 * `lamps` lights with the leaf-boat drawing (`diya-floating`) instead of a lamp planted on nothing.
 * The seed is the box's own shape, never the page number, so a re-render of the same family draws
 * the same river (art/README.md rule 6).
 */
export function lampRows(n, box) {
  if (n <= 0) return [];
  const rows = rowsFor(n);
  const base = Math.floor(n / rows), extra = n % rows;
  const rand = seeded(`lamp-rows ${box.x} ${box.y} ${box.w} ${box.h}`);
  const rowGap = rows > 1 ? (box.h * 0.82) / (rows - 1) : 0;
  const out = [];
  let at = 0;
  for (let i = 0; i < rows; i++) {
    // The far rows are the fuller ones: perspective crowds what is furthest away.
    const count = base + (i < extra ? 1 : 0);
    const t = rows === 1 ? 1 : i / (rows - 1);          // 0 far, 1 near
    const spread = FAR_SPREAD + (1 - FAR_SPREAD) * Math.pow(t, 0.8);
    const cyBase = box.y + box.h * (0.12 + 0.82 * t);
    const cy = Math.min(box.y + box.h, Math.max(box.y, cyBase + (rand() - 0.5) * rowGap * 0.32));
    const half = (box.w * spread) / 2;
    const cx = box.x + box.w * (0.5 + 0.06 * (1 - t));   // the far rows sit a little upstream
    // the rows near the foot grow fastest, which is how a receding row of lamps really looks
    const w = Math.min(FAR_LAMP + (NEAR_LAMP - FAR_LAMP) * t * t, count > 1 ? ((2 * half) / (count - 1)) * 0.95 : NEAR_LAMP);
    const tilt = (rand() - 0.5) * w * 0.5;
    out.push({
      from: at, count, x1: cx - half, x2: cx + half, y: cy, w,
      y1: cy - tilt, y2: cy + tilt, boat: t > 0.72,
    });
    at += count;
  }
  return out;
}

/**
 * The rows a zone-scale glow belongs over: the ones whose own lamps are the glow-less `diya-small`.
 * A row of `diya` or of leaf boats carries its own flame, so a disc laid over it only greys the
 * water; and a disc laid where there is no row at all was the loudest thing on a small family's
 * 150 px cover. Nearest first, at most two, never the same row twice.
 */
export function rowsToWarm(rows) {
  // A small family's lamps are few enough to be looked at one at a time, and a zone disc over them
  // is simply a grey halo on the water - at fifteen it was the loudest thing on the 150 px cover.
  // The zone glow exists for the crowd, so it starts when there is a crowd.
  if (rows.reduce((n, r) => n + r.count, 0) < GLOW_ZONE_FROM) return [];
  const dim = rows.filter((r) => !r.boat && r.w < GLOWS_ABOVE);
  if (!dim.length) return [];
  const pick = [...new Set([dim.length - 1, Math.floor((dim.length - 1) / 2)])];
  return pick.map((i) => dim[i]);
}

/**
 * The lamp field: `ids` in the order the book knows them, one lamp each, and a person whose name
 * nobody knows lit by the dashed-bowl lamp the app's own notation keeps for them.
 */
function lamps(ctx, ids, box, seed) {
  const unknown = new Set(ids.map((id, i) => (ctx.family.byId.get(id)?.name ? -1 : i)).filter((i) => i >= 0));
  const items = [];
  for (const [i, row] of lampRows(ids.length, box).entries()) {
    const at = new Set([...unknown].filter((k) => k >= row.from && k < row.from + row.count).map((k) => k - row.from));
    const lamp = row.boat ? 'diya-floating' : row.w >= GLOWS_ABOVE ? 'diya' : 'diya-small';
    const drawn = diyaRow(ctx.art, row.x1, row.y1, row.x2, row.y2, row.count, `${seed} lamps ${i}`, { w: row.w, jitter: 0.3, unknownAt: at, lamp, unknownLamp: 'diya-unknown' });
    if (drawn) items.push(drawn);
  }
  return items;
}

/**
 * The family at the ghat: a few figures seen from behind, watching the lamps. They are scenery and
 * count nobody - always the same small group, whatever the family's size, drawn flat in the night's
 * own colours so no reader can mistake one for a relative (book-design-system.md, principle 1).
 *
 * Round 2 (finding 5): `haze`, `deep`, `glow` and `night` are four near-identical dark violets
 * (book-design-system.md's own palette table lists them together, darkening toward the reader), so
 * all four flattened into one row of bollards. Three clearly separated tones instead - `deep` is
 * the night sky's own near-black, `dusk` its lightest, warmest step, `glow` between them - and the
 * leftmost figure moves in from 0.14 to 0.22 of the box, which used to sit close enough to the
 * page's own bleed edge to clip.
 */
const GHAT_FIGURES = Object.freeze([
  { art: 'hero-female-adult', at: 0.22, h: 0.6, tint: 'dusk' },
  { art: 'hero-person-adult', at: 0.42, h: 0.68, tint: 'deep' },
  { art: 'hero-person-child', at: 0.6, h: 0.42, tint: 'glow' },
  { art: 'hero-male-adult', at: 0.82, h: 0.64, tint: 'deep' },
]);

/**
 * A cloth border stripe: `tint` on `art.place` recolours a whole figure to one flat paper, so a
 * border can only be added as a second, narrower shape over the same spot rather than a part of
 * the tinted drawing itself. One short curved stroke at shoulder height, in `gold`, reads as trim
 * on the drape without a new asset (round 2, finding 5's "a border stripe on the cloth").
 */
function shoulderStripe(P, cx, footY, h) {
  const w = h * 0.5, y = footY - h * 0.56;
  const d = new PathData().M(cx - w / 2, y).Q(cx, y + h * 0.05, cx + w / 2, y);
  return path(String(d), { stroke: P.gold, sw: 1.1, op: 0.45 });
}

const figures = (ctx, box) => GHAT_FIGURES.flatMap((f) => {
  const cx = box.x + box.w * f.at, footY = box.y + box.h, h = box.h * f.h;
  return [
    ctx.art.place(f.art, { x: cx, y: footY, anchor: 'bottom-center', h, tint: f.tint }),
    shoulderStripe(ctx.P, cx, footY, h),
  ];
});

function cover(ctx, page, story) {
  const { P, tpl, family, art } = ctx;
  describe(ctx, page);
  const mirror = page.variant.endsWith('-mirrored');
  const seed = family.title;
  const place = scenePlacement(mirror);
  const ghat = scene(ctx, 'ghat-night', place);
  const ids = [...story.kin.people.keys()];
  // Round 2, finding 20: the cover's own count, spelled out and capitalised for the sentence it
  // opens ("Twenty-three lamps..."), the same form templates/diwali.json's format-1 cover already
  // carries - `{n}` alone would print a bare digit mid-sentence. The cover fills `tpl.cover`'s own
  // text rather than a `copy` chapter, so it reaches the two spelled forms through copy.js's
  // `withCountWords` directly, which is where `renderCopy` gets them too (#258 round 2).
  const vars = withCountWords({ ...chapterVars('cover', family, story.kin), n: ids.length });

  const items = [ghat.item];
  const top = ghat.at('toran');
  items.push(toran(art, P, top.x, top.x + top.w, top.y + 22, `${seed} toran`, { size: 26 }));
  for (const at of [0.19, 0.81]) {
    // hung well below the toran on a thread, as the approved cover hangs them
    const x = top.x + top.w * at, y = top.y + 64;
    items.push(path(new PathData().M(x, top.y + 34).L(x, y).toString(), { stroke: P.gold, sw: 0.8, op: 0.7 }));
    items.push(art.place('kandil', { x, y, w: 44 }));
    ctx.zone('busy', { x: x - 26, y: top.y + 30, w: 52, h: 96 });
  }
  items.push(...figures(ctx, ghat.at('figures')));
  const lampsZone = ghat.at('lamps');
  // Round 2 (finding 6): past GLOWS_ABOVE, most lamps are the glow-less `diya-small`, which at 200
  // people left only the near row lit and the cover reading as a muddy smear with no warm heart.
  // Two zone-scale `glowDiscs` clusters - near and mid - cost almost nothing next to per-lamp
  // glow (`diyaRow.js`'s own budget note), scaled up a little for a larger family's fuller rows.
  // A disc has to sit on a row that exists. At fixed fractions of the zone, a fifteen-lamp cover
  // laid its rows at 0.12 and 0.94 and both discs landed in empty water - the two loudest objects
  // on its 150 px thumbnail, lighting nothing. So warm only the rows whose own lamps are the
  // glow-less `diya-small`, at those rows' real centres, and leave a family small enough to glow
  // by itself alone.
  const warmth = Math.min(1, ids.length / 120);
  for (const [k, row] of rowsToWarm(lampRows(ids.length, lampsZone)).entries()) {
    const r = (row.x2 - row.x1) * (0.3 + 0.08 * warmth) * (k ? 0.7 : 1);
    items.push(glowDiscs(P, (row.x1 + row.x2) / 2, row.y, r, k ? P.gold : P.flame));
  }
  items.push(...lamps(ctx, ids, lampsZone, seed));
  // The one rangoli this book may afford beside "Still to be found"'s: laid flat on the landing,
  // tilted onto the floor the way the approved frames tilt theirs.
  const rx = mirror ? 148 : W - 148;
  items.push(group([rangoli(P, 0, 0, 52, `${seed} rangoli`)], { tf: [1, 0, 0, 0.34, rx, H - 48], op: 0.7 }));
  ctx.zone('busy', { x: rx - 56, y: H - 66, w: 112, h: 40 });

  const title = ghat.at('title');
  const cx = midX(title), width = title.w;
  // Set as large as the zone allows: the cover is read at 150 px in a chat app before it is ever
  // read at full size, and the greeting and the family's own line are what have to survive that.
  const greetingSize = ctx.fit(tpl.cover.greeting, 'display', 52, width, 26);
  const subtitle = fillPlaceholders(tpl.cover.subtitle, vars);
  const subtitleSize = ctx.fit(subtitle, 'display', 36, width, 18);
  items.push(ctx.line(cx, title.y + 56, tpl.cover.greeting, 'display', greetingSize, P.gold, { align: 'middle', width, kind: 'title' }));
  items.push(ctx.line(cx, title.y + 56 + greetingSize * 0.96, subtitle, 'display', subtitleSize, P.card, { align: 'middle', width, kind: 'title' }));
  // "One lamp for each of us" over a river with no lamps on it: a book with nobody in it yet has
  // the greeting and the family's own line, and says the rest on the page that follows.
  const line = ids.length ? fillPlaceholders(pickLine(tpl.cover.line, vars.n), vars) : null;
  if (line) {
    items.push(...ctx.lines(cx, title.y + 62 + greetingSize * 0.96 + subtitleSize * 1.2, line, 'hand', 16, P.flame, { width, maxLines: 2, lead: 22, align: 'middle', kind: 'caption' }).items);
  }
  if (ctx.attribution) {
    // Round 2, finding 15: `flame` - the palette's lightest warm token - still read as
    // near-invisible against the cover's own deep night sky; `card`, a near-white, does not.
    const credit = ghat.at('credit');
    items.push(ctx.line(credit.x + 4, credit.y + 15, 'Made with f-tree', 'text', 7.5, P.card, { width: credit.w, op: 0.85, kind: 'folio' }));
  }
  return ctx.page(tpl.cover.greeting, items, P.deep);
}

/* ------------------------------------------------------------------ the arch pages */

/** A small bird, two shallow wings from one point: cheap enough to place a couple with no motif. */
const birdD = (x, y, s) => `M${x - s} ${y}Q${x - s / 2} ${y - s} ${x} ${y}Q${x + s / 2} ${y - s} ${x + s} ${y}`;

/**
 * One skyline silhouette, appended to `d` as straight segments along the horizon: a shikhara
 * (a stepped, tapering tower), a dome or chhatri (a small pavilion's roof) on the same rounded
 * silhouette at two heights, or a rooftop water tank. `docs/book-design-system.md` lists all four
 * under "architecture"; none is a compiled `LIBRARY` symbol (`site/book/art/README.md`'s asset
 * list has only the arch itself, the aala niche and the flora), so this draws the silhouette the
 * same way `paperGround`'s clouds and `sanjhiBand`'s tiles already draw page furniture - plain
 * primitives, not a new asset (round 2, finding 3).
 */
function appendSilhouette(d, cx, base, w, h, kind) {
  if (kind === 'dome' || kind === 'chhatri') {
    const r = w / 2, domeH = kind === 'chhatri' ? h * 0.5 : h * 0.68;
    d.L(cx - r, base).L(cx - r, base - domeH * 0.3)
      .C(cx - r, base - domeH * 0.3 - r * 0.9, cx + r, base - domeH * 0.3 - r * 0.9, cx + r, base - domeH * 0.3)
      .L(cx + r, base);
  } else if (kind === 'tank') {
    const r = w * 0.34;
    d.L(cx - r, base).L(cx - r * 1.4, base - h * 0.08).L(cx - r, base - h * 0.55).L(cx + r, base - h * 0.55).L(cx + r * 1.4, base - h * 0.08).L(cx + r, base);
  } else {
    d.L(cx - w / 2, base).L(cx - w / 2, base - h * 0.15).L(cx - w * 0.3, base - h * 0.15).L(cx - w * 0.3, base - h * 0.42)
      .L(cx - w * 0.16, base - h * 0.42).L(cx - w * 0.16, base - h * 0.74).L(cx, base - h).L(cx + w * 0.16, base - h * 0.74)
      .L(cx + w * 0.16, base - h * 0.42).L(cx + w * 0.3, base - h * 0.42).L(cx + w * 0.3, base - h * 0.15).L(cx + w / 2, base - h * 0.15).L(cx + w / 2, base);
  }
}

/**
 * The day seen through an arch window, as three flat layers (round 2, finding 3: one linear
 * gradient and a stray flame read as an orange wall with a stain, not a view): the washed sky down
 * to the warm middle distance with the low sun and a couple of birds; a skyline of shikharas, a
 * dome, a chhatri and a water tank; a `wash` river band along the foot, with a ripple or two.
 * `mirror` turns the whole view around - the sun's side, which way the skyline runs - so two
 * arches side by side (`portraitHero`) are a pair, not a mirror of each other (finding 14).
 */
function view(ctx, box, { mirror = false, seed = 'view' } = {}) {
  const P = ctx.P;
  const ref = ctx.gradient(`view-${Math.round(box.y)}-${Math.round(box.y + box.h)}`, {
    type: 'linear', x1: 0, y1: box.y, x2: 0, y2: box.y + box.h,
    // Round 2, finding 16: the old stops put `dayHaze` almost the whole way down, so a `flame`
    // sill lamp had almost no contrast to sit against. `dayMid` now owns the lower half.
    stops: [[0, P.sky, 1], [0.42, P.dayHaze, 1], [0.82, P.dayMid, 1]],
  });
  const items = [rect(box.x, box.y, box.w, box.h, { fill: ref })];

  const sunX = box.x + box.w * (mirror ? 0.36 : 0.62);
  items.push(circle(sunX, box.y + box.h * 0.25, Math.min(box.w, box.h) * 0.115, { fill: P.flame, op: 0.85 }));

  const rand = seeded(`${seed} view`);
  for (let i = 0; i < 2; i++) {
    items.push(path(birdD(box.x + box.w * (0.14 + rand() * 0.68), box.y + box.h * (0.13 + rand() * 0.09), 2.6 + rand() * 1.4), { stroke: P.ink, sw: 0.7, op: 0.45 }));
  }

  const baseY = box.y + box.h * 0.58;
  const kinds = mirror ? ['tank', 'shikhara', 'chhatri', 'shikhara', 'dome'] : ['dome', 'shikhara', 'chhatri', 'shikhara', 'tank'];
  const d = new PathData().M(box.x, baseY).L(box.x, baseY + 5);
  const step = (box.w * 0.86) / (kinds.length - 1);
  kinds.forEach((kind, i) => {
    const cx = box.x + box.w * 0.07 + step * i;
    appendSilhouette(d, cx, baseY + 3, box.w * (0.08 + rand() * 0.02), box.h * (0.13 + rand() * 0.07), kind);
  });
  d.L(box.x + box.w, baseY + 5).L(box.x + box.w, baseY).Z();
  items.push(path(String(d), { fill: P.stone }));

  const riverY = box.y + box.h * 0.82;
  items.push(rect(box.x, riverY, box.w, box.y + box.h - riverY, { fill: P.wash, op: 0.55 }));
  const ripple = new PathData();
  for (let i = 0; i < 2; i++) { const ry = riverY + (box.y + box.h - riverY) * (0.32 + i * 0.34); ripple.M(box.x + box.w * 0.1, ry).L(box.x + box.w * 0.9, ry); }
  items.push(path(String(ripple), { stroke: P.card, sw: 0.6, op: 0.3 }));

  return items;
}

/**
 * The shape the opening and the waiting page share: a day page with an arch window, and a block of
 * words. The variant decides which comes first - `arch` puts the window at the top and the words
 * under it, `window` turns the page over - which is the whole of the design system's "no two
 * consecutive pages share both a composition and an art placement".
 */
const ARCH_WIDTH = 296;

function archPage(ctx, page, { label, frame, words, sillLamps = 2 }) {
  const { P } = ctx;
  const seed = `${ctx.family.title} ${page.chapter}`;
  const high = page.variant === 'arch';
  const outer = frameOuter('arch-jharokha', (W - ARCH_WIDTH) / 2, high ? 104 : 326, ARCH_WIDTH);
  const items = [paperGround(ctx, ctx.family.title), sanjhiBand(ctx, seed)];
  // The haveli facade the jharokha sits in (round 2, finding 2): drawn first, so the window is
  // built into a wall rather than floating on bare paper.
  items.push(...haveliFacade(ctx, outer, seed));
  const opening = openingIn('arch-jharokha', outer);
  items.push(...frame(outer, opening));
  // Lamps on the sill. Nothing on this page counts people, so a lamp here is ornament, which is
  // the one condition the design system puts on a decorative lamp. A clay halo behind each one
  // (round 2, finding 16) gives `flame` something darker than a pale wall to sit against.
  const sill = sillLamps === 1 ? [0.5] : [0.24, 0.76];
  for (const k of sill) {
    const x = opening.x + opening.w * k, y = opening.y + opening.h + 5, w = sillLamps === 1 ? 34 : 24;
    items.push(circle(x, y, w * 0.6, { fill: P.clay, op: 0.3 }));
    items.push(ctx.art.place('diya', { x, y, w }));
  }
  // The busy zone covers the whole facade, not just the arch itself, now that the wall, its
  // parapet and its vines reach past the arch's own frame on every side.
  ctx.zone('busy', { x: outer.x - 34, y: outer.y - 58, w: outer.w + 68, h: outer.h + 98 });

  const block = words(high ? outer.y + outer.h + 52 : SAFE.y + 40);
  items.push(...block.items);
  // The page ends with a tailpiece where the words do, so neither half of it floats in white.
  if (high) items.push(...tailpiece(ctx, W / 2, Math.min(block.bottom + 64, SAFE.y + SAFE.h - 34), seed));
  items.push(...folio(ctx, P.inkSoft));
  return ctx.page(label, items, P.paper);
}

/**
 * The kin medallion row (round 2, finding 17): up to four of F's closest relatives - both parents,
 * a spouse, then children (or, failing those, siblings) until the row is full - small medallions
 * with a name and the kin word beneath, the reader's first sight of the family and, the approved
 * opening frame's own words, "the warmest thing on the page". Nobody invented: a circle F has
 * nobody in is simply not drawn from, and the row is shorter rather than padded.
 */
const KIN_ROW_MAX = 4;

function kinRowIds(kin) {
  const ids = [];
  const take = (list) => { for (const id of list ?? []) if (ids.length < KIN_ROW_MAX) ids.push(id); };
  take(kin.circles.parents);
  take((kin.circles.spouses ?? []).slice(0, 1));
  take(kin.circles.children);
  if (ids.length < KIN_ROW_MAX) take(kin.circles.siblings);
  return ids;
}

function kinRow(ctx, story, cx, y, rowWidth) {
  const { family, kin } = { family: ctx.family, kin: story.kin };
  const ids = kinRowIds(kin);
  if (!ids.length) return { items: [], bottom: y };
  const size = 50, gap = ids.length > 1 ? Math.min(26, (rowWidth - ids.length * size) / (ids.length - 1)) : 0;
  const rowW = ids.length * size + Math.max(0, ids.length - 1) * gap;
  const featuredName = nameOf(family, kin, kin.featured);
  let x = cx - rowW / 2 + size / 2;
  const items = [];
  let bottom = y;
  for (const id of ids) {
    const person = family.byId.get(id) ?? null;
    const outer = frameOuter('medallion', x - size / 2, y, size);
    items.push(...framedPerson(ctx, person, {
      id: 'medallion', outer, hero: false, gen: kin.people.get(id)?.gen ?? null, featuredBy: family.byId.get(kin.featured)?.by ?? null,
    }));
    let at = outer.y + outer.h + 13;
    const name = nameOf(family, kin, id);
    if (name) { items.push(ctx.line(x, at, name, 'strong', 10.5, ctx.P.ink, { align: 'middle', width: size + 14, kind: 'name' })); at += 13; }
    const word = kinCaption(kin, family, id, featuredName);
    if (word) { items.push(ctx.line(x, at, word, 'hand', 10.5, ctx.P.clay, { align: 'middle', width: size + 14, kind: 'caption' })); at += 12; }
    bottom = Math.max(bottom, at);
    x += size + gap;
  }
  return { items, bottom };
}

function openingHero(ctx, page, story) {
  const { P, family } = ctx;
  describe(ctx, page);
  const person = family.byId.get(page.people[0]);
  const copy = chapterCopy(page.copyKey, { family, kin: story.kin, tpl: ctx.tpl }, pageVars(page));
  const sentence = openingLine(family, story.kin) ?? copy?.line ?? null;
  const caption = yearsCaption(ctx, story, person);
  return archPage(ctx, page, {
    label: copy?.title || 'The opening',
    frame: (outer, opening) => framedPerson(ctx, person, {
      id: 'arch-jharokha', outer, hero: true, gen: 0, featuredBy: person?.by ?? null, view: view(ctx, opening, { seed: person?.id ?? 'opening' }),
    }),
    words: (y) => {
      const items = [];
      let at = y;
      if (caption) {
        items.push(ctx.line(W / 2, at, caption, 'hand', 14.5, P.inkSoft, { align: 'middle', width: SAFE.w, kind: 'caption' }));
        at += 32;
      }
      const block = titleBlock(ctx, { title: copy?.title, line: sentence, cx: W / 2, y: at, width: 430, titleSize: 34, lineSize: 13, lead: 19, maxLines: 5 });
      items.push(...block.items);
      let bottom = block.bottom;
      // An eldest F has no roots or courtyards chapter: the opening is where the book says so,
      // rather than leaving the reader to notice two chapters missing (plan.js's `folds`).
      const first = page.folds.length ? nameOf(family, story.kin, story.kin.featured) : null;
      if (first) {
        bottom += 32;
        items.push(ctx.line(W / 2, bottom, `${first} is the first name this family remembers.`, 'hand', 13.5, P.clay, { align: 'middle', width: SAFE.w, kind: 'caption' }));
      }
      const row = kinRow(ctx, story, W / 2, bottom + 30, 420);
      if (row.items.length) { items.push(...row.items); bottom = row.bottom; }
      return { items, bottom };
    },
  });
}

/**
 * The book with nobody to feature: an arch with a lamp lit in it and nobody at the window. Its
 * words are its own - the template's opening copy is written around a person this book has not
 * got, so filling it would print "This is." - and they are the app's own invitation.
 */
const WAITING_TITLE = 'A book waiting for its family';
const WAITING_LINE = 'There is no one in this family tree yet. Add the people you remember, with a name, a year or a photograph, and the next book will be about them.';
const WAITING_HAND = 'The lamp is lit, and the door is open.';

function waiting(ctx, page) {
  const { P } = ctx;
  describe(ctx, page);
  return archPage(ctx, page, {
    label: WAITING_TITLE,
    frame: (outer, opening) => [ctx.art.frame('arch-jharokha', opening, view(ctx, opening, { seed: 'waiting' }), { shadow: { dx: 1.7, dy: 2.3 } })],
    sillLamps: 1,
    words: (y) => {
      const block = titleBlock(ctx, { title: WAITING_TITLE, line: WAITING_LINE, cx: W / 2, y: y + 12, width: 420, titleSize: 30, lineSize: 13, lead: 19, maxLines: 5 });
      const bottom = block.bottom + 34;
      return { items: [...block.items, ctx.line(W / 2, bottom, WAITING_HAND, 'hand', 14, P.clay, { align: 'middle', width: SAFE.w, kind: 'caption' })], bottom };
    },
  });
}

/* ------------------------------------------------------------------ a portrait hero */

/**
 * One or two people with the room to be looked at: a chapter too small for a gathering
 * (`plan.js`'s hero density). `arch` stands them at windows, `niche` mounts them in medallions -
 * two placements of the same composition, so two such pages in a row never look alike.
 */
function portraitHero(ctx, page, story) {
  const { P, family } = ctx;
  describe(ctx, page);
  const arches = page.variant === 'arch';
  const people = page.people.map((id) => family.byId.get(id) ?? null);
  const copy = chapterCopy(page.copyKey, { family, kin: story.kin, tpl: ctx.tpl }, pageVars(page));
  const featuredName = nameOf(family, story.kin, story.kin.featured);
  const seed = `${family.title} ${page.chapter}`;
  const items = [paperGround(ctx, family.title), sanjhiBand(ctx, seed)];

  const head = titleBlock(ctx, { title: copy?.title, line: page.continued ? null : copy?.line, cx: W / 2, y: SAFE.y + 46, width: 430, titleSize: 32, lineSize: 12.5, lead: 18, maxLines: 3 });
  items.push(...head.items);
  if (!arches) items.push(ctx.art.place('divider-lotus', { x: W / 2, y: head.bottom + 26, w: 150 }));

  const id = arches ? 'arch-jharokha' : 'medallion';
  const top = head.bottom + (arches ? 54 : 74);
  const one = people.length === 1;
  const width = one ? (arches ? 262 : 236) : (arches ? 210 : 190);
  const gap = one ? 0 : Math.min(60, W - 2 * SAFE.x - 2 * width);
  const left = (W - (people.length * width + gap)) / 2;
  const boxes = people.map((p, i) => frameOuter(id, left + i * (width + gap), top, width));

  /*
   * A departed hero's mala hangs below the frame, never across the person (round 2, finding 1),
   * so the name stack under it starts further down by the same drop.
   *
   * #287: the drop was taken per person, so on a page with one departed partner and one living
   * one the two name stacks sat about 110 pt apart and the pair looked unfinished. One drop for
   * the page, taken from whether anyone on it is departed, keeps the two baselines level. Every
   * box on the page is the same width, so the opening is the same size in each.
   */
  const drop = arches && people.some((p) => p?.deceased) ? MALA_DROP * openingIn(id, boxes[0]).w : 0;

  let lowest = top;
  let noted = false;
  people.forEach((p, i) => {
    const outer = boxes[i];
    const opening = openingIn(id, outer);
    // Round 2, finding 14: two arches side by side used to be a mirror of each other - the same
    // view, the same sun's side, the same cusping. The second person's whole frame (the jharokha's
    // own cusped silhouette included) turns around its own box, and its view is its own seed.
    //
    // #287, finding 14: the view is drawn unmirrored and the group flip below does the turning.
    // Passing `mirror` here as well put the sun on the left and then the flip put it back, so the
    // two negations cancelled and both suns landed on the same side - the copy-and-paste the
    // round 2 fix was for, still there behind a mirror that mirrored nothing.
    const mirror = arches && i === 1;
    const framed = framedPerson(ctx, p, {
      id: p?.photo && ctx.options.photos && !arches ? 'medallion-carved' : id,
      outer, hero: arches, gen: story.kin.people.get(p?.id)?.gen ?? null, featuredBy: family.byId.get(story.kin.featured)?.by ?? null,
      view: arches ? view(ctx, opening, { seed: p?.id ?? `${seed} ${i}` }) : [],
    });
    if (mirror) items.push(group(framed, { tf: [-1, 0, 0, 1, 2 * (outer.x + outer.w / 2), 0] }));
    else items.push(...framed);
    const stack = nameStack(ctx, story, p, { cx: outer.x + outer.w / 2, y: outer.y + outer.h + (arches ? 30 : 40) + drop, width: width + gap / 2, featuredName });
    items.push(...stack.items);
    lowest = Math.max(lowest, stack.bottom);
    // At most one handwritten note to a page (book-design-system.md), so the first person who has
    // one gets it, and it sits under both portraits rather than beside one of them.
    const note = noted || page.continued || !p ? null : noteFor(ctx, page, p);
    if (note) {
      noted = true;
      items.push(noteCard(ctx, note, { cx: W / 2, y: Math.min(lowest + 46, H - 176), width: 340 }).items);
    }
  });
  if (people.length === 2) {
    // The diya between a bereaved couple stands on the sill line, not at head height (round 2,
    // finding 18): the same y a sill lamp would use, read off the first frame's own opening.
    const sillY = openingIn(id, boxes[0]).y + openingIn(id, boxes[0]).h;
    items.push(...joinFrames(ctx, people[0], people[1], {
      cx: W / 2, y: sillY, width: Math.max(40, boxes[1].x - (boxes[0].x + boxes[0].w) + 30),
    }));
  }
  if (boxes.length) ctx.zone('busy', { x: boxes[0].x, y: top, w: boxes[boxes.length - 1].x + width - boxes[0].x, h: boxes[0].h });
  // A page that ends early closes with a tailpiece rather than a field of empty paper.
  if (!noted) items.push(...tailpiece(ctx, W / 2, Math.min(lowest + 74, SAFE.y + SAFE.h - 34), seed));
  items.push(...folio(ctx, P.inkSoft));
  return ctx.page(copy?.title || page.chapter, items, P.paper);
}

/**
 * The person's own note, where the reader asked for notes and a chapter on this page may show one.
 * A household page carries several chapters; `copy.js`'s `noteCaption` owns both rules (opt-in, and
 * `plan.js`'s `NO_NOTES`), so this only asks it, once per chapter the page is drawn from.
 */
const noteFor = (ctx, page, person) => page.chapters.map((c) => noteCaption(c, ctx.family, person.id, ctx.options)).find(Boolean) ?? null;

/* ------------------------------------------------------------------ the closing */

const MISSING = 'Is someone missing?';
const SCAN = 'Scan to get f-tree';

function closing(ctx, page, story) {
  const { P, tpl, family } = ctx;
  describe(ctx, page);
  const mirror = page.variant.endsWith('-mirrored');
  const sky = scene(ctx, 'closing-sky', scenePlacement(mirror));
  const copy = chapterCopy(page.copyKey, { family, kin: story.kin, tpl }, pageVars(page));
  const items = [sky.item];

  const title = sky.at('title');
  // Round 2 (finding 19): the closing used to reprint the cover's own greeting and its
  // "from the X family" line word for word, with no `hand` face anywhere on the page. Its own
  // farewell (`tpl.copy.closing.title`, the lead's own words) replaces both, set in the book's
  // handwritten voice rather than the cover's display face.
  const farewell = copy?.title || tpl.cover.greeting;
  const size = ctx.fit(farewell, 'hand', 30, title.w, 18);
  items.push(ctx.line(midX(title), title.y + 60, farewell, 'hand', size, P.flame, { align: 'middle', width: title.w, kind: 'title' }));

  const missing = sky.at('missing');
  items.push(ctx.line(midX(missing), missing.y + 30, MISSING, 'display', 28, P.flame, { align: 'middle', width: missing.w, kind: 'title' }));
  // Round 2 (finding 15): this invitation used to be set in `text` over `card`, the driest voice
  // the book has, on the one page that is entirely the reader's own next move. `hand`/`flame`
  // matches the approved closing frame's own register.
  if (copy?.line) items.push(...ctx.lines(midX(missing), missing.y + 62, copy.line, 'hand', 14, P.flame, { width: missing.w - 40, maxLines: 3, lead: 20, align: 'middle', kind: 'body' }).items);

  if (ctx.attribution) {
    // Mounted like a photograph (round 2, finding 8): a soft paper shadow, a cream mat, a gold
    // hairline, the code centred in its own zone rather than pushed to the trim, the caption
    // underneath rather than floating beside it.
    const qr = sky.at('qr');
    const plate = Math.max(40, Math.min(92, qr.w, qr.h - 26));
    const x = qr.x + (qr.w - plate) / 2;
    // Round 2 (finding 12 fallout): the folio now alternates sides by page parity, so the credit
    // can land under a QR zone that sits low on the page. Room for the plate, the caption under
    // it and a clear footer row all have to fit above the folio, not just the plate alone.
    const y = Math.min(qr.y + Math.max(0, (qr.h - plate - 24) / 2), H - plate - 46);
    items.push(rect(x + 1.7, y + 2.3, plate, plate, { fill: P.ink, op: 0.28 }));
    items.push(rect(x, y, plate, plate, { r: 8, fill: P.card }));
    items.push(rect(x, y, plate, plate, { r: 8, stroke: P.gold, sw: 1.4 }));
    items.push(qrPath(SITE_QR, x + 8, y + 8, plate - 16, P.deep));
    items.push(ctx.line(x + plate / 2, y + plate + 17, SCAN, 'text', 9.5, P.card, { align: 'middle', width: Math.max(plate + 40, 130), kind: 'caption' }));
  }
  // Round 2 (finding 15): the folio credit used to print in `flame` - already the palette's
  // lightest warm token - which still read as near-invisible against a night page. `card` is the
  // one token lighter than it, the same near-white the QR's own caption now uses above.
  items.push(...folio(ctx, P.card));
  return ctx.page(MISSING, items, P.deep);
}

/* ------------------------------------------------------------------ shared */



/** Archetype id -> draw(ctx, page, story). #256: cover, opening-hero, waiting, portrait-hero, closing. */
export const PAGES = Object.freeze({
  cover,
  'opening-hero': openingHero,
  waiting,
  'portrait-hero': portraitHero,
  closing,
});
