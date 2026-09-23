# The storybook family book ("Aangan"): plan and handoff

This is the plan behind umbrella **#239**, written for whoever builds it next, including an AI
session. It was made on 2026-09-16, and Ankit approved the visual direction the same day.

> **Status (2026-09-22): waves 1 and 2 have landed. Wave 3 is next.**
> - **Wave 1:** #241 (Book format 2 in JS), #242 (Kalam `book_hand`), #243 (template format 2) and
>   #244 (composer options) are done.
> - **Wave 2:** all done.
>   - Formats and shells: #246 (Android format 2), #247 (art compiler + `draw.js`), #248 (Android
>     book screen), #249 (desktop book dialog).
>   - Story logic: #250 (`kin.js`), #251 (`plan.js`), #252 (`copy.js`).
>   - Art: #253 (frames, avatars, motifs), #254 (six scenes), #255 (procedural).
> - **#245 is open**, but only for the storybook half: its invariants run over the story book
>   once it exists. Everything else in it has landed.
> - **Next is wave 3** (#239): #256–#258 (page archetypes), then #259 (the swap, **must merge by
>   2026-10-12**) and #260 (release checks).
>   - If #256–#258 are at risk on 2026-10-05, post a reduced page set on #239.
>   - Never cut the register, the completeness guarantee or any non-negotiable.
> - Read **"Handover after wave 2"** below before starting, including **"Wave 2, second half"**.

## The idea, in one breath

A family book that feels like a keepsake storybook somebody made for this family, not a report
generated from a database. It is told as *the story of one person, told through the family they
belong to*. A **featured person** is the emotional centre. Their parents, grandparents, siblings,
spouse and children carry the story, and the wider family spreads out from them.

It is drawn as a **paper-cut lightbox**: Sanjhi-style layers of cut paper with Diwali's lamplight
glowing between them. The central image is the cover's: *one lamp for each of us*.

## What we believe (read before drawing or coding anything)

1. **The art invents nobody.**
   - People without a photograph are faceless: a paper-cut bust in a medallion, or at hero size a
     figure seen from behind, looking at the view.
   - People in scenes are small, seen from behind, and never stand for a particular relative.
   - We never paint a made-up face onto someone's real grandmother.
2. **One lamp per person** wherever lamps count people.
3. **Everyone in scope appears somewhere.**
   - The register is the completeness guarantee, and a template cannot leave it out.
   - A person whose name is lost is named by relation ("Shyam Lal's wife"), not "unknown".
4. **Composition, not labels.** The featured person is larger, central or first. The book never
   prints "featured".
5. **Photographs are never altered.** They sit in a carved ring on a cream mat, untinted.
6. **Readable before beautiful.** The density floors in the design system are enforced by tests.
7. **The app's promises still hold.**
   - Local-first, offline, deterministic, private by default: the living show their birth year
     only, and no page gives a living person an age.
   - The PDF stays under 10 MB, and the cover reads at 150 px wide.
   - Heirloom's output stays byte-identical.
8. **Cultural care.**
   - No religious symbols stand for a family.
   - A mala hangs only on a departed person's frame, and never toward a living person.
   - A diya, not a mauli, sits between a couple where one has died.
   - Kin words come from the reviewed vocabulary.

## Decisions (all approved by Ankit, 2026-09-16; raise changes on #239, do not relitigate in PRs)

| Decision | Why |
|---|---|
| Vector paper-cut art only, no raster illustrations | No image-generation pipeline. Android's `PdfDocument` stores bitmaps losslessly (about 4 MB per full-page plate) against a 10 MB chat budget. Vector prints sharp and recolours |
| Notes appear only through an opt-in *Include notes* switch, off by default | Notes are the only stories in a record, but a Diwali book is forwarded to people nobody chose |
| The featured person is a generic option on every template, and only Diwali uses it for now | The control belongs to the book screen; Heirloom keeps its output |
| People without photos are faceless; heroes with no photo are seen from behind | The art never invents a likeness. A front-facing faceless bust at hero size looks like a UI placeholder |
| The register replaces Diwali's `generations` + `find` pages | Story pages weight the featured person's circles, and the register keeps everyone |
| The cover stays the family's; the featured person enters on page 2 | The cover is the chat thumbnail and speaks for everyone |
| Book format 2 declares the lowest format that draws a book | Heirloom stays format 1, and its goldens stay byte-identical |
| Parents' kin words are पिताजी / माँ | Respectful and widely used |
| The mala on a departed person's frame stays | How Indian homes honour ancestors, on the frame only |
| The cover keeps शुभ दीपावली plus the English family line | Approved as drawn |
| The storybook is built as a hidden `diwali-story` template and swapped into `diwali.json` last (#259) | Diwali is featured from **2026-10-18**. If the swap isn't merged by **2026-10-12**, the current Diwali ships |

## Start here

**If you are picking this up** (person or Claude session):

1. **Read, in order:**
   1. this file;
   2. [book-design-system.md](book-design-system.md);
   3. [family-book.md](family-book.md), the Book format and the composer's promises;
   4. [`site/book/art/README.md`](../site/book/art/README.md);
   5. the umbrella #239 and the issue you are taking.
2. **Look at the approved frames** in [`site/book/art/style-frames/approved/`](../site/book/art/style-frames/approved/).
   *They are the visual contract*: if the design system and a frame disagree, the frame wins.
   Re-render them with
   `site/book/art/style-frames/render.sh <out> <fonts>`. `<fonts>` must hold the three
   `app/src/main/res/font/book_*.ttf` files plus `book_hand.ttf`, which is Kalam Regular (OFL)
   from Google Fonts until #242 lands.
3. **Take wave 1:** #241, #242, #243, #244, #245. They are independent and can run in parallel.
   **#241 (Book format 2)** unblocks the most: the Android painter (#246) and the art compiler
   (#247).
4. **The frames' drawing kit is the seed of the asset library.**
   - `kit.mjs`, `motifs.mjs` and `frames.mjs` are hand-placed. Nothing in them is composer code.
   - #247 turns motifs into compiled symbols, and #253–#255 turn them into assets.
   - Keep the look. Rewrite the plumbing.
5. **One issue, one branch** (`feat/book-…`), one PR, and tag last.

### Working rules and traps

- **The composer's banned APIs** are `new Date`, `Date.now`, `localeCompare`, `Intl.`,
  `document.`, `window.`, `Math.random`, `setTimeout` and `fetch(`. The test reads a fixed file
  list today (`site/book/book.test.mjs`), so until #245 lands, a new composer file is unguarded
  unless it is added to that list by hand.
  - **#245 replaces the list with the static import closure of `compose.js`**, not a directory
    glob, because the closure is exactly what Android's `bookEngine()` stages
    (`app/build.gradle.kts:61`). Guarding the closure guards `story/*.js` and `art/*.js` the day
    they appear, and it catches an accidental import of a UI module.
- **`searchPeople` (`site/playground/search.js`) is UI-only, forever.** It sorts with
  `localeCompare`. The book screens may call it; nothing the composer imports ever may, or the
  book stops being deterministic and gets staged into the WebView as well.
- **Imports.**
  - Android stages only JS reachable through **static relative imports** from `compose.js`
    (`app/build.gradle.kts`, `bookEngine()`), so no dynamic `import()`.
  - Any new `site/playground/*.js` import must also be added to the Gradle test inputs.
- **`relate()`** in `site/playground/model.js` rebuilds stand-ins on every call. Memoise it and
  never loop it over everyone. **`ageOf`** reads the clock, so never call it from the composer.
- **The Android exporter omits empty lists**: a one-person tree has no `relationships` key.
  Default everything.
- **`readBook`** (`Book.kt`) must refuse unknown font keys. Today `BookPainter` silently skips any
  text whose typeface is missing.
- **Clip edges** on Android can be jagged, so always draw a frame stroke over them.
- **Glows** are stacked translucent discs (`glowDiscs`). Radial gradients with alpha stops become
  PDF soft masks, so keep them to about ten per page.
- **The machine has 14 GB.** Don't run Gradle, the emulator and Playwright at once, and serialise
  Gradle across worktrees with `flock`.
- **Stacked PRs.** `gh pr merge --delete-branch` on a stacked PR's base closes the child.
  Retarget the child to `main` first.
- **Data.** Never commit a real family's data or photographs. Use the synthetic fixtures and
  `tools/make_sample_tree.py`.

## Handover after wave 2 (2026-09-22)

What the next issues can build on, and the rulings made on the way. Each merged PR's review
comment has the detail.

**Rulings (Ankit, 2026-09-21):**
- **Silhouette `use`** (a use with `fill`): the fill is one solid palette colour. It replaces every
  fill and stroke inside the symbol, gradients included. Stroke geometry and inner opacities are
  kept. The use's `op` is one group alpha: svg.js puts opacity on the wrapping `<g>`, and Android
  uses `saveLayerAlpha`. This matches the design system's paper shadow, "the same shape, offset".
- Merges no longer need Ankit's per-PR "merge". **Betas and tags still do.**

**APIs now on `main`:**
- **Format 2:** `format.js` exports `MAX_SYMBOL_DEPTH = 4` and `MAX_EXPANDED_ITEMS = 20000` (per
  page). Both painters enforce them. `site/book/golden/format2-conformance.json` is the shared
  fixture, and its checklist test keeps its coverage honest.
- **Templates:** `template.js` exports `PAPERCUT_PALETTE_KEYS` (29), `REQUIRED_CHAPTERS`,
  `HAND_FONT_KEY` and `ROLE_FONT_KEYS`. Kalam is only ever the hand role. `composeBook` still
  refuses a format-2 template by name; #251 routes it to `storyBook(ctx)`.
- **Featured person:** `ctx.featured` is resolved once (`story/featured.js`). Notes arrive clamped as
  `person.note` only when `options.notes`. `pageBlocks` honours `options.coverOnly`.
- **`story/kin.js`:** `kinOf(family, featuredId, {words})` partitions everyone into 12 circles, with
  role, side, gen, branch, via and `namedBy`. `words(id)` gives `{en, hi, term, word, through}`.
  `through` marks a relation through one marriage; #252 phrases it the way the desktop's
  `sentenceFor` does. It isn't imported by `compose.js` yet: #251 wires it in, and then
  `bookEngine()` stages the Hindi kinship files automatically.
- **`art/draw.js`:** `place(id, {x, y, w|h, anchor, flip, shadow, tint})`, `zones`, `frame` and
  `box`. It collects only the symbols a book uses.
  - `tools/book_art.mjs` compiles `art/src/papercut/**.svg`, and `--check` runs in CI.
  - Seeded so far: `diya`, `marigold`, `arch-jharokha` (lace as dotted strokes).
  - `data-clip` and `<g data-asset>` exist for frame openings and nesting.
- **QA (#245):**
  - `composeWithReport` gives `shown`, `textBoxes`, `artZones`, `minSize` and `pages`. Pages record
    through `ctx.show`, `ctx.zone`, `ctx.describePage` and a byte-neutral `kind` on lines.
  - `drawable(tpl)`.
  - The fixtures are `story-*.json` (from `tools/make_sample_tree.py --book-fixtures`).
  - The invariant suite skips the storybook until it exists, and a flag test fails if a story
    composer lands without being covered.
  - `tools/book_contact_sheet.mjs` renders the pages for review by eye.
- **Shells:** Android and desktop both pass `featured`, `notes`, `words` and `coverOnly`. Both decide
  "features one person" from the template's `format === 2`.

**Warnings for what comes next** (the rest of wave 2, #251–#255, and wave 3, #256–#260):
- **Art weight.** At the style frames' density, a 28-page book prints at about 18.6 MB, against the
  10 MB budget. Keep to the per-kind budgets: a repeated shape is one symbol placed many times, or
  a stroke, never copies. Keep paper shadows cheap too.
- **The art term** in `estimateBytes` was measured in Chromium (margin ×1.95). #259 must
  re-measure on Android's PdfDocument, and raise it if Android is bigger.
- **Old small print.** Format-1 tree-page years print at 6.4 pt and are grandfathered at 6 pt.
  Storybook pages get the full density floors.
- **Open follow-ups, outside the storybook path:**
  - #268: `layout.js` `byBirth` uses `localeCompare`. The fix may move the goldens, so it needs its
    own PR.
  - #271: the relation panel calls a former spouse "wife", and the spouse-status rule lives in two
    places.
- **Still to do by eye:** a `/run` of the real desktop dialog and a saved PDF, and a release build
  exercised on the emulator. Both are scheduled with #260's release checks.

**Wave 2, second half (#251–#255, merged 2026-09-22): what wave 3 builds on**
- **`story/plan.js` (#251):** `planStory(kin, template, family, options)` returns
  `{featured, shape, pages, pagesOf, registerOnly}`.
  - Each page is `{pageNo, chapter, archetype, variant, people, copyKey, continued, …}`.
  - It exports `CHAPTERS`, `MIN_CONTINUATION = 3`, `MAX_STORY_PAGES = 28`, `EXTRA_PAGE_PRIORITY`,
    `TINY` and `NO_NOTES` (the register).
  - `compose.js` routes a format-2 template to `storyBook(ctx)`, which runs `kinOf` and
    `planStory` and then refuses by name: the archetypes don't exist yet. **#256–#258 replace that
    throw.** `DRAWABLE_FORMATS` stays `[1]` until they do; #245's flag test enforces this.
- **`story/copy.js` (#252):**
  - `chapterCopy(chapterId, {family, kin, tpl})` covers every chapter.
  - Composed sentences: `openingLine`, `rootsLine`, `stillToBeFoundCaption`, and `numberFact`
    (`{one, many}` nouns).
  - Names and captions: `nameOf` ("Shyam Lal's wife", never "Unknown"), `kinCaption` (Hindi or
    English per `words`), `noteCaption`.
  - Each clause is optional and drops out when its fact is missing. Birth order appears only when
    every full sibling's year is known.
- **Art library (#253, #254):**
  - **Avatars:** faceless busts by gender × 4 stages × 2 variants. With no photo, the hero is seen
    from behind (`hero-*`); a youth uses the adult figure.
  - **Frames:** `medallion`, `medallion-petals` (group portraits; a petal rim, never a marigold
    ring), `medallion-carved`, `cameo`, `arch-jharokha`.
  - **Motifs and ornaments:**
    - lamps: the diya family, and `lamp-unknown` (dashed brass: a person whose name isn't known);
    - `aala` (the only other brass), `mala-departed`;
    - kandil, lotus, peepal, toran, `mango-leaf`, `marigold-bead`;
    - `band-sanjhi` tiles, corner, divider.
  - **Scenes:** `ghat-night` (cover), `banyan`, `aangan`, `haveli-lane`, `remembrance-night`,
    `closing-sky`. They hold no people and no counting lamps. Pages place those in named zones:
    `art.zones(id, …)` returns `{kind, name?, …}` for text, lamps, figures, medallions, aala niches,
    plates and QR.
  - **Compiler:** a `fill` on a `<use>` or `<g data-asset>` is a silhouette. A shadow shares its
    shape's compiled part.
  - **`art.place('mala-departed', …)` throws without `{ departed: true }`.** Pass it only when the
    record says the person has died.
- **Procedural (#255), in `art/procedural/`:**
  - `rangoli(P, cx, cy, R, seed)`: at most about 13 KB.
  - `toran(art, P, x1, x2, y, seed)`: mango leaves with alternate marigolds, about 168 KB at full
    width.
  - `diyaRow(art, …, count, seed, {unknownAt})`: exactly `count` lamps, about 138 KB for 8 and
    828 KB for 48.
  - Seeds come from the family, never the page number.
- **For the archetypes (#256–#258), from review:**
  - A page lighting a whole family needs several diya rows or smaller lamps: 48 on one row
    overlap. Lamp count drives PDF weight almost linearly.
  - Tilt a rangoli onto the floor, as `style-frames/frames.mjs` does.
  - `aangan` always draws both houses. Crop it when only one side of the family is known.
  - The six scenes add about 270 KB before lamps and frames. Budget pages against the 10 MB cap
    from the start.
  - Planner edge for #245: an unnamed tree of 5 or more people plans 4 pages, which the drafted
    page-count invariant rejects. Add a fixture and settle the rule.
  - Open for Ankit: aunts and uncles appear both on the parents page and in their lane.
- **Not yet checked on a device:** rendering the art library through BookPainter. Both painters
  have supported every primitive it uses (silhouettes, dashes, even-odd, clips) since #246, but no
  page draws the art yet. #259 renders the book on the emulator when it re-measures the art term.

**Wave 3's scaffolding (on `main` before #256-#258 started)**
- **`site/book/story/pages/`** is the archetype dispatch. `index.js` merges `hero.js` (#256: cover,
  opening-hero, waiting, portrait-hero, closing), `family.js` (#257: banyan, courtyards, gathering)
  and `lists.js` (#258: lane, numbers, register, still-to-be-found, legacy) into one `PAGES` map, so
  the three issues never edit the same file. A page archetype is
  `draw(ctx, page, story) -> { label, items }`, where `page` is the `PagePlan` and `story` is
  `{ kin, plan }`; `index.js` carries the full contract.
- **`compose.js`'s `storyBook`** now draws through that map: `ctx.art` is the art library
  (`art/index.js`), `options.coverOnly` draws the cover alone off the whole book's plan (so its
  page numbers are the real ones), and `book.symbols` comes from `ctx.art.symbols()`.
- **`DRAWABLE_FORMATS` is computed,** not written: format 2 joins it the day `PAGES` covers every
  archetype in `plan.js`'s `VARIANTS`, so no issue has to remember to flip a flag and a
  half-finished storybook refuses by naming the archetypes nobody has drawn yet.
- **`site/book/qa/story-template.mjs`** is the one storybook template every wave-3 test composes
  against (the approved palette, all 14 chapters, the copy). It is test-only: a file in
  `templates/` must be in the catalogue (`catalog.test.mjs`) and a catalogued format-2 entry must be
  drawable (`invariants.test.mjs`), so `templates/diwali-story.json` can only land once the last
  archetype has - with #245's storybook run, before #259 swaps Diwali itself over.

**How the work was run:** one worktree and branch per issue. Sub-agents never ran Gradle, the
emulator or Electron; one session ran those, one process at a time. `/code-review` and `/simplify`
ran on every PR, and every regression test was checked to fail without its fix.
Art PRs
also went through three rounds of an Opus design critic. The critic compared specimen PNGs
(rendered through `svg.js` in Chromium) against `style-frames/approved/`. Wave 3 pages should
run the same loop over `tools/book_contact_sheet.mjs` output.

## Story sequence (adapts to the data)

The featured person is F. Each chapter is skipped when empty, merged when small, and split when
large.

| # | chapter | content |
|---|---|---|
| 1 | Cover | *शुभ दीपावली / from the X family*: night ghat, a lamp per person, one line. Legible at 150 px |
| 2 | Opening | An arch-window hero of F, plus a composed sentence ("Ankit was born in 1995, the eldest of three children of Rajesh and Sunita. This is the family behind him.") |
| 3 | Roots | F's earliest known ancestors, on banyan roots: "N generations before Ankit" |
| 4 | Two courtyards | Paternal and maternal grandparents as two households. One household if only one side is known |
| 5 | Parents | Large frames with a marigold string. Their siblings (F's aunts and uncles) appear smaller |
| 6 | Growing up together | Siblings, including half-siblings, grouped by the parents they share |
| 7 | A new family joins | Spouse(s), including former or late partners with the existing wording, plus in-laws |
| 8 | The next lamps | Children and grandchildren |
| 9 | Our lane | A house per aunt or uncle branch, with their spouses and children (F's cousins); splits by branch |
| 10 | In numbers | Illustrated vignettes with F-relative facts ("Ankit has 23 cousins"). No living person's age |
| 11 | Everyone | The register of everyone in scope, by branch, with page references. People not linked get their own section |
| 12 | Still to be found | Lamps for unknown names, placed relative to F ("Ankit's great-grandmother on his mother's side") |
| 13 | Legacy | Back to F: one lamp per generation along F's line, plus a handwritten note |
| 14 | Closing | Happy Diwali, the QR code, "Is someone missing?", the credit |

**Adaptations to the data:**
- **F is the eldest:** the story flows downward, and Roots/Courtyards fold into the Opening.
- **F is a child:** chapters 7–8 are skipped.
- **Tiny families** collapse to 5–7 pages.
- **About 200 people** gives roughly 22–28 pages.

**Notes.** With the switch on, a person's note appears as a handwritten caption beside their
portrait on story pages. It is clamped to 3 lines with control characters stripped, and it never
appears in the register.

**Kin captions.** Family chapters caption each frame with the kin word in the hand face:
- **Hindi.** When the reader's *Family words* setting is Hindi (`options.words: 'hi'`), the words
  come from the reviewed vocabulary in `site/playground/kinship-hi.js` (दादी, नानी, बुआ, मामा…).
- **English.** Otherwise the English words are used ("grandmother").
- **No word.** Where Hindi has none, the English word is used, as the app already does.
- **Both shells** start passing `words`, which neither does today.

## Architecture

Checked against the code by the architecture review.

**Book format 2** (`site/book/format.js`, `svg.js`, `Book.kt`, `BookPainter.kt`)
- **A book declares the lowest format that draws it.** `formatOf(book)` returns 2 only when a
  book uses `clip`, `use` or `symbols`, and the painters accept 1 and 2. That keeps Heirloom
  byte-identical, so `golden.txt`'s Heirloom lines and `golden/sample-heirloom.json` are
  unchanged.
- **`group.clip`:** absolute path `d`, in the group's own coordinates, nonzero rule. It frames
  photos in arches and shows scenes through windows. Every clip edge is always covered by a frame
  stroke, because Android's preview can draw clip edges jagged.
- **`book.symbols {id: {items}}` plus a new `use {ref, tf?, op?, fill?}` item.** A `use` with
  `fill` (a solid `#rrggbb`) is silhouette mode: every fill and every stroke takes that colour,
  and stroke width, dash, cap, join and inner opacities are kept, so stroke-only art stays a line.
  That matches the design system's paper shadow, "the same shape, offset", and is how paper
  shadows and tints are drawn. The `use`'s `op` is one layer over the whole silhouette (decided
  by Ankit, 2026-09-21; the full rule is in `docs/family-book.md`). `svg.js` expands `use` inline so pages joined into one print file
  cannot collide on ids. Android parses each path once through a `HashMap<String, Path>` cache.
- **The hand font needs no format bump,** because `Book.fonts` is an open map. `readBook` must
  refuse any font key the printer does not carry: `BookPainter.kt:92` skips such lines today, which
  loses text silently.
  - **#241 writes that contract down and ships the conformance fixture; #246 implements it in
    Kotlin.** #241 is the JS half only, so the two issues do not both own `Book.kt`.
  - Reading `format` before the rest is **already done** (`Book.kt:220`). #246 keeps a test for
    it rather than changing it.

**Template format 2** (`template.js`, Kotlin `BookCatalog`, a new row in `catalog-cases.json`).
Heirloom stays on format 1, and a catalogue entry at format 2 is hidden from older apps:
```
{format:2, id, name, fileSuffix, art:"papercut",
 fonts:{display,text,strong,hand}, palette:{…29 semantic tokens, all required},
 cover:{greeting,subtitle,line}, story:{chapters:[…]}   // must include cover, opening, register, closing
 copy:{<chapter>:{title, line|{one,other}}}}             // placeholders {featured} {featured-first} {family} {n} {year}
```
`compose.js` sends format-2 templates to `storyBook(ctx)`. The format-1 `BLOCKS` loop is
untouched.

The 29 palette tokens are the `PALETTE` the approved frames were rendered from
(`site/book/art/style-frames/motifs.mjs`), written up in
[book-design-system.md](book-design-system.md#palette): `paper paperDeep card ink inkSoft night
deep glow dusk gold flame brass marigold saffron sindoor rani peacock indigo leaf leafDeep stone
clay skin silver sky wash haze dayHaze dayMid`. Format-1 templates keep their own 22
`PALETTE_KEYS` in `template.js`, untouched, so Heirloom gains no required field.

**Assets** (`site/book/art/`)
```
art/src/papercut/{scenes,avatars,frames,motifs,ornaments}/*.svg   authored sources (not shipped)
art/src/papercut/swatches.json                                    authoring hex → palette token
art/papercut/{scenes,avatars,frames,motifs,ornaments}.js          generated, committed
art/procedural/{rangoli,toran,diyaRow}.js                         seeded generators
art/seed.js   (seeded() moved from blocks/art.js)
art/draw.js   ctx.art.place(id,{x,y,w|h,anchor,flip,shadow,tint}) → use item
              ctx.art.zones(id,placement), ctx.art.frame(kind,box,inner)
art/index.js  static imports only (Android's import walk stages them)
art/README.md contributor conventions
```

`tools/book_art.mjs` compiles the sources. It has no dependencies, like `font_metrics.mjs`.
- **Parsing and conversion:** a small XML reader. Relative, S/T and A (arc) commands, plus
  ellipse, polygon and rect, become absolute `M L C Q Z`. Transforms are baked in, and
  coordinates are rounded to 0.01.
- **Colour:** every colour maps to a token through the swatch file, and an unmapped colour fails
  the build. This lets designers paint in Inkscape or Figma.
- **Refused:** filter, mask, pattern, image, text, style and class.
- **Metadata:** `data-anchor` and `<rect data-zone="text|face|busy">` are read, then stripped.
- **Byte budgets per kind:** avatar ≤2.5 KB, frame ≤4 KB, scene ≤40 KB.
- **`--check`** runs in `pages.yml` and `desktop.yml` next to `font_metrics --check`.
- **Desktop packaging:** `extraResources` must exclude `art/src/**`.

Built in #247. The contributor workflow and the `draw.js` API are in
[site/book/art/README.md](../site/book/art/README.md). What it settled beyond the list above:
- **A frame marks its opening** with one `data-clip` shape. `ctx.art.frame()` clips its contents
  to it and draws the frame over the clip edge.
- **A drawing places another** with `<g data-asset="id">` around a pasted preview copy. It
  compiles to a `use`, so a scene's marigolds cost their bytes once.
- **Budgets count what crosses the bridge:** a drawing's items, parts and gradients, not its
  placement metadata. Motifs and ornaments get 4 KB, like a frame.
- **Seed drawings:** `diya`, `marigold` and `arch-jharokha`, converted from the style-frame
  kit, with the kit's curves fitted as cubics. The jharokha's lace, 89 punched holes along the
  arch, would be 15 KB as hole subpaths and about 6 KB as 89 `use`s of one hole, against a 4 KB
  frame budget. It is drawn instead as two dotted strokes along the lace line, round caps on
  near-zero dashes, big and small dots alternating: a few hundred bytes, drawn the same way by
  both painters. A row of the same small mark along a curve is cheapest drawn this way.

**Story planner** (`site/book/story/`, pure, deterministic)
- **`featured.js resolveFeatured`** tries, in order:
  1. `options.featured`, if it survives scope and allowance;
  2. the branch root when `scope=branch`;
  3. `mostConnected` among named people (`site/playground/focus.js`);
  4. for an empty tree, a cover, a "waiting for its family" page and the closing.
- **`kin.js`:** one typed BFS from F that **partitions** everyone into exactly one circle, and
  the first claim wins.
  - **Circles:** self, parents, paternal and maternal grandparents, ancestors, siblings (full,
    half, explicit), spouses (current, former, late), in-laws, children by other parent,
    descendants, aunt/uncle branches, lane, elsewhere.
  - **Words** come from `termFor`/`kinshipLabel`, and Hindi from `hindiWord`.
  - **`relate` is memoised** and called only for the roughly 150 people shown. It rebuilds
    stand-ins on every call (`model.js:614`). The planner never calls `ageOf`, which reads the
    clock.
- **`plan.js`:** `ChapterPlan` → `PagePlan{archetype, variant, people, copyKey, continued, pageNo}`.
  - **Page numbers** are assigned before anything is drawn, so register references are exact.
  - **Splitting** balances pages, with at least 3 entries on a continuation page. Small chapters
    merge into a "household" page.
  - **Variety:** a page takes the first variant that differs from the previous page's.
  - **Cap:** about 28 story pages. Everyone beyond that is in the register.

  Built in #251 (`site/book/story/plan.js`, tested by `plan.test.mjs`). What it settled:
  - **Chapter ids** a template may list are `CHAPTERS`: `cover opening roots courtyards parents
    siblings spouses children lane numbers register still-to-be-found legacy closing`. They
    include template.js's `REQUIRED_CHAPTERS`, and the planner refuses an id it doesn't know.
    #259's `diwali-story` must use these.
  - **Who each chapter shows**, from kin.js's circles: roots = ancestors; courtyards =
    grandparents; parents = parents, aunts and uncles, and a parent's other spouse; siblings =
    siblings and their spouses; spouses = spouses and the spouse's parents, siblings and other
    children; children = children, descendants and their spouses; lane = the aunt/uncle branches
    and the wider lane, a house per kin branch. still-to-be-found = everyone linked to F with no
    recorded name. Anyone on no story page is in the register (`registerOnly`), which lists
    everyone in scope.
  - **Density:** family pages hold 8, gatherings (roots, courtyards, still-to-be-found) 12, a lane
    page 4 houses of up to 8, and the register 48 rows, counting one row per section heading.
    Splits are balanced, with the larger pages last. Consecutive family chapters under 3 people
    each share a household page; `copyKey` is its first chapter.
  - **Cap:** each chapter keeps its first page. Extra pages go to parents, courtyards, siblings,
    spouses, children, roots, still-to-be-found and then the lane, until 28 story pages are used.
    The register is never cut.
  - **Shapes:** eldest F (nobody above them) folds roots and courtyards into the opening
    (`folds`), and spouses and children come before siblings. Child F has no spouse or children
    pages. A tiny family (at most 5 people) has no numbers page, which gives 5–7 pages. A tree with
    people but nobody named to feature is a cover, a waiting page, the register and the closing. `story-large`
    (200 people) plans 25 pages.
  - **`compose.js`** sends a format-2 template to `storyBook(ctx)`, which runs `kinOf` and the
    planner, then refuses by name to draw: the archetypes are #256–#258. `DRAWABLE_FORMATS` stays
    `[1]` until they land.
- **Supporting modules:** `copy.js` (built in #252, below), `avatars.js` (gender × life stage ×
  variant by stable hash; any unknown gender value counts as unspecified), `pages/*.js` (the
  archetypes).

  **`copy.js`** (`site/book/story/copy.js`, tested by `copy.test.mjs`), pure functions keyed by
  chapter id and person, for the archetypes (#256-#258) to call:
  - **`renderCopy(entry, vars)`** fills a template's `copy[chapter]` (`{title, line:{one,other}}`)
    from `vars`, choosing the plural by `vars.n`. It reuses `template.js`'s own `PLACEHOLDER`
    regex (exported for this; the accepted-name set stays private to template.js, which already
    refuses anything else at load time) rather than a second parser. A missing `vars` entry is
    dropped - never a stray `{placeholder}` or "undefined" - the tidy-up loops until nothing more
    changes (three or more dropped facts in a row need more than one pass to clean up fully), and
    a labelled aside whose one fact is missing is dropped whole, parens included ("Ankit (born
    {year})." with no year is "Ankit.", not "Ankit (born ).").
  - **`chapterVars`/`chapterCopy(chapterId, {family, kin, tpl})`** is the table over `renderCopy`
    for every chapter id `plan.js`'s `CHAPTERS` lists: `{n}` from the same circle `plan.js`'s
    `MEMBERS` draws that chapter from (never a second tally), `{featured}`/`{featured-first}`/
    `{year}` only when the featured person is nameable, `{family}` from the family's own title.
  - **`nameOf(family, kin, id)`** is the one name a page ever prints: the record's own, or - belief
    3 - `kin.js`'s `namedBy` turned into a phrase ("Shyam Lal's wife"), never "Unknown".
  - **`kinCaption(kin, family, id, featuredName?)`** is `words(id).word` (already
    Hindi-then-English, the app's own fallback) plus the one case it cannot hand back as a single
    word: `through`, phrased the way the desktop's `sentenceFor` phrases it ("married to Ankit's
    cousin", "the grandmother of Ankit's wife"), never a possessive chain. Deliberately *not*
    subtype-blind the way the desktop panel is: an ex-spouse's own record shows through
    (`kin.words`'s "former wife"), more accurate for a family book, so the two texts can differ
    here. A caller that already has the featured person's name (`stillToBeFoundCaption` does) may
    pass it, so a page captioning several people off one `kin` never resolves it twice.
  - **`noteCaption(chapterId, family, id, options)`** returns the already-clamped note only when
    `options.notes` and `plan.js`'s `NO_NOTES` doesn't name this chapter - that one table (today
    just the register, which lists everyone by name alone) owns the rule, not a chapter-id string
    compared here.
  - **`countInCircle`/`numberFact`** read a circle's own count (optionally filtered by `role`),
    never a second tally - "Ankit has 23 cousins" and the copy layer's `{n}` agree by construction.
    `numberFact`'s noun is a plain string, regularly pluralised, or an explicit `{one, many}` pair
    for one that isn't ("child" -> "children"; a naive `${noun}s` would print "childs").
  - **`openingLine`, `rootsLine`, `stillToBeFoundCaption`** are composed sentences, not
    placeholder fills, because they need a birth-order claim, a generation count or a side that a
    5-token template line cannot express. Each clause is independently optional: no birth year (the
    featured person's own, or *any* full sibling's - an unsorted unknown year would otherwise sort
    as youngest by accident and risk a false "eldest") drops the ordinal claim ("Ankit is a child
    of Rajesh and Sunita", never "the eldest" without one to back it), the ordinal past `ORDINALS`'
    own word list gets English's real suffix (21st, not 21th - 11th-13th excepted), no recorded
    parent drops the whole clause, and nothing here ever reaches for a pronoun, so a missing gender
    never needs handling - `model.js`'s own labels are already gender-neutral where the record
    doesn't say.
- **Completeness:** `composeWithReport()` returns `{book, report:{shown, textBoxes, artZones,
  minSize}}`. Tests assert that `shown` covers everyone in scope. A template cannot leave out the
  register.
- **Hero portraits** may ask for up to 512 px (today's cap is 200) and stay inside the existing
  `budgetPhotos`. `estimateBytes` gains a vector-art term, which belongs to **#245** because that
  issue owns the 10 MB invariant. The term is **measured** from real paper-cut PDFs on both
  painters, never guessed, and it estimates high rather than low. #259 re-checks the constant
  against the finished Diwali book.

**Options and shells.** The composer gains `options.featured`, `options.notes` and
`options.coverOnly`.
- **`coverOnly`:** covers compose the whole book today (`BookViewModel` `drawCovers`, desktop
  `book.js:344`). The option stops that.
- **Android** (`ui/book/BookScreen.kt`, `BookViewModel.kt:163`):
  - A **"Whose story"** row with a picker. `PersonPicker` moves from `ui/relation/RelationSheet.kt:423`
    to `ui/common`.
  - An **"Include notes"** switch.
  - `words` passed from the Family-words setting.
  - `BookOptions` gains the new fields.
- **Desktop** (`renderer/book.js`, `book-options.js`, dialog `index.html:317-382`): the same
  controls, and the picker uses `site/playground/search.js searchPeople` over a graph built from
  `getDocument()`.
- **On Heirloom:** both controls stay visible with the hint *"Heirloom doesn't feature one person
  yet."*
- **Timeline guard:** the storybook is built as a hidden `diwali-story` template, not in the
  catalogue. The swap into `diwali.json` is one issue. Diwali is featured from **2026-10-18**. If
  the storybook isn't merged by **Oct 12**, the current Diwali keeps shipping.

## Issues (label `aangan-storybook`)

"∥" marks issues that can run in parallel within their wave. Every issue also depended on the
gate (#240), which has passed.

| Issue | Scope | Depends on | Model |
|---|---|---|---|
| #239 | **Umbrella:** Family book storybook (Aangan) | – | Opus |
| #240 | Design system doc + six style frames: **the approval gate, PASSED 2026-09-16** | – | Opus |
| #241 ∥ | Book format 2 **in JS only**: `format.js`, `validateBook`, `formatOf`, `svg.js`, the `readBook` strictness contract in `family-book.md`, and the conformance fixture #246 reads; Heirloom goldens unchanged | – | Opus |
| #242 ∥ | Kalam `book_hand` at 10–18 pt: subset, metrics, all five FONT_KEYS copies, printer, desktop embed, `fonts.md`, and the OFL licences the desktop package does not ship yet | – | Sonnet |
| #243 ∥ | Template format 2 validator + catalogue JS/Kotlin + cases | – | Sonnet |
| #244 ∥ | Composer options `featured`/`notes`/`coverOnly`, `resolveFeatured`, notes read in `family.js` | – | Sonnet |
| #245 ∥ | QA harness: report, invariants, `estimateBytes`'s measured vector-art term, synthetic storybook fixture (`tools/make_sample_tree.py`), Playwright contact sheet, banned-API guard over `compose.js`'s import closure | – | Sonnet |
| #246 | Android format 2 **and the whole Kotlin side**: `Book.kt`, `BookPainter` (clip, use, path cache, and refusing an unknown font key with a clear error instead of `BookPainter.kt:92`'s silent skip), read against #241's conformance fixture | #241 | Opus |
| #247 | Art compiler `tools/book_art.mjs` + `draw.js` + scaffolding + CI check, including `--check` failing when `swatches.json`'s tokens differ from `template.js`'s paper-cut palette key list | #241 | Opus |
| #248 ∥ | Android shell: shared PersonPicker, Whose story, notes switch, words, `coverOnly` | #244 | Sonnet |
| #249 ∥ | Desktop shell: picker, notes, words, `coverOnly`, `book-options` tests | #244 | Sonnet |
| #250 | `kin.js` partition + synthetic-family tests (F eldest, leaf, remarriage, half and explicit siblings, 12 siblings, 3 spouses, unlinked F) | #244 | Opus |
| #251 | `plan.js`: split, merge, variety, register, page refs | #250, #243 | Opus |
| #252 ∥ | `copy.js`: sentences, fallbacks, kin captions | #250 | Sonnet |
| #253 ∥ | Assets I: arches and frames, avatars, diyas, marigold, toran, lotus, ornaments | #240, #247 | Opus |
| #254 ∥ | Assets II: scenes (ghat night cover, banyan, courtyard, haveli lane, remembrance night, closing sky) | #240, #247 | Opus |
| #255 ∥ | Procedural rangoli/kolam, toran strings, diya rows | #247 | Sonnet |
| #256 ∥ | Archetypes A: cover, opening hero, portrait hero, closing | #251, #253, #254 | Opus |
| #257 ∥ | Archetypes B: banyan medallions, two courtyards, gathering band | #251, #253 | Opus |
| #258 ∥ | Archetypes C: lane, numbers, register, still-to-be-found, legacy | #251, #253 | Opus |
| #259 | Swap `diwali.json` to v2, catalogue format 2, Diwali goldens, `family-book.md`, architecture decisions table, site copy | #256–#258, #246, #248, #249 | Sonnet |
| #260 | Release checks: `BookPdfTest`/`BookFlowTest` on the storybook fixture, desktop smoke, device pass, beta cut (only when Ankit says) | #259 | Sonnet |

## Verification

- **JS tests:** `node --test site/book/*.test.mjs`. Heirloom goldens stay identical. Diwali is
  regenerated once, at issue 20.
- **Invariants,** over every fixture × 3 featured choices (most connected, eldest, a leaf):
  - everyone in scope is shown;
  - sizes: text ≥7 pt, body ≥10.5, names ≥9;
  - no text overlaps other text or sits in a busy zone;
  - consecutive pages vary;
  - page count stays within bounds;
  - JSON ≤1.5 MB on the large fixture and ≤150 KB a page;
  - the estimated PDF stays under 10 MB;
  - no living person's age appears;
  - the banned-API glob passes.
- **CI:** `node tools/book_art.mjs --check` and `font_metrics --check`.
- **Android:**
  - `BookFormatTest` parses `sample-story.json`.
  - `BookPdfTest` passes on the storybook fixture: A4, `/FontFile2`, no `/Type3`, under 10 MB,
    and the preview matches the PDF.
  - A release build is exercised on the emulator.
- **Desktop:** `FTREE_SMOKE_BOOK` and `book-options.test.js`.
- **By eye:**
  - A Playwright contact sheet of every fixture is reviewed against the style frames.
  - The real `temp/*.ftree` trees are used locally only, never committed.
  - The cover must stay legible at 150 px wide.
