# The family book

A family book is the tree as a designed, printable PDF: a cover, the whole family on one page, the
family in numbers, a page for each generation, an index to find yourself in, and a closing page
that asks who is missing. It is made on the device, offline, by the same code on Android and on
the desktop. Tracked in #200.

## One composer, two painters

```
 .ftree document ──► composeBook(doc, options, template, allowance) ──► Book (a display list)
                     site/book/compose.js, run by both shells                │
                                                                             ├─► desktop: svg.js → SVG pages
                                                                             │   → hidden window → printToPDF
                                                                             └─► Android: WebView returns the
                                                                                 Book → Canvas painter →
                                                                                 PdfDocument
```

The composer is written once, in JavaScript. Every decision about the page is made there: where
each person goes, how each line of text breaks, which pages exist. It hands each shell a **Book**:
a list of pages, each a list of drawing items with every coordinate already settled. A painter
draws the items it is given and decides nothing. That split is what lets the desktop and the phone
produce the same book from the same tree. It is also why a new template never costs two
implementations: a template chooses among the things the composer knows how to draw, and the
painters never learn anything new.

The composer reads the viewer's own model and layout (`site/playground/model.js`,
`site/playground/layout.js`). So the book's tree page and the chart agree about who sits where,
and a kinship fix reaches both at once.

## The Book, format 1

`site/book/format.js` is the source of truth. This section is what a painter must honour.

```
{ format: 1, template, title, fileName, size: { w: 595, h: 842 },
  fonts: { display, text, strong },          // role → font file key (book_display, ...)
  defs:  { <id>: gradient },
  photos: [ { id, px } ],                    // which portraits to fetch, and at what resolution
  pages: [ { label, items: [ ... ] } ] }
```

Pages are A4 in PostScript points. Android's `PdfDocument` takes whole points, so the size is an
integer pair and never changes.

| item | fields | notes |
|---|---|---|
| `rect` | `x y w h [r] [fill] [stroke sw dash] [op]` | `r` is a corner radius |
| `circle` | `cx cy r [fill] [stroke sw dash] [op]` | |
| `path` | `d [fill] [stroke sw dash cap join] [rule] [op]` | `d` uses absolute `M L H V C Q Z` only; `rule` is `nonzero` (default) or `evenodd` |
| `text` | `x y s font size fill [align] [w] [op]` | one line; `y` is the baseline; `align` is `start` (default), `middle` or `end`; `font` is a role |
| `image` | `id x y w h clip [op]` | `id` is a person; `clip` is `circle` or `rect`; the photograph covers the box (centre crop) |
| `group` | `items [tf] [op]` | `tf` is an affine `[a b c d e f]`, SVG's `matrix()` order |

**Fills.** A fill is `#rrggbb` or `{ ref }` naming a gradient in `defs`. A missing fill means no
fill. Opacity is only ever `op`, on an item or a gradient stop, never an alpha in a colour.

**Gradients** are `{ type: 'linear', x1 y1 x2 y2, stops }` or
`{ type: 'radial', cx cy r, stops }`, with `stops` as `[offset, colour, opacity]`. They are in user
space: page coordinates after any group transform. The one exception is `units: 'item'`, allowed
only on a radial gradient that fills a circle. Its centre and radius are then in units of that
circle's radius, from its centre. That is how one glow serves every star on a page. SVG expresses
it with `objectBoundingBox`; Android builds a `RadialGradient` per circle.

**Text is never wrapped by a painter.** The composer breaks lines using advance tables generated
from the embedded fonts (`tools/font_metrics.mjs`), and gives each line the width `w` it measured.
A painter whose font engine measures a line wider than `w` shrinks its size until it fits. It never
grows one. For Latin text the tables are exact and nothing shrinks. For Devanagari, shaping makes
a conjunct narrower than the sum of its parts, so the composer allows a 6% margin and the shrink
covers the rest. `svg.js`'s `fitText` returns how many lines it touched; the preview reports it.

**Photographs** are fetched by person id at the `px` in `book.photos`. The composer chooses it from
the size a portrait prints at: about 170 pixels per inch, never under 96 or over 200. Android's
`PdfDocument` stores bitmaps losslessly, so that choice is what keeps a family's book small enough
to send in a chat app. A photograph the painter cannot load is left out, and the portrait's ring
still stands.

**Refuse, don't approximate.** A painter refuses a `format` it does not know, before it reads
anything else in the book. It also refuses a book that names a font key it does not carry, rather
than drawing the page without those lines: a missing typeface used to mean a silently skipped line
in `BookPainter.kt`, which is how a name could disappear from a family's book with nobody told.
So `readBook` checks the book's `format` first, then every role in `book.fonts` against the faces
the release embeds, and every `text` item's role against `book.fonts`. A book that fails is
refused with a message naming the key, and the reader is told the book cannot be made. Half a
sentence is never printed. (`Book.fonts` is an open map, so a new face never bumps the format and
this check is the only thing standing between a new face and a quietly incomplete page.)
`validateBook` lists everything a painter may rely on. The composer's tests run it on every book
they make. Android's `readBook` runs its Kotlin twin (`BookValidation.kt`, #246) on every book the
WebView hands back, with the font-key check added against `BookFonts.FILES`, the faces the
release actually embeds; `BookFormat2Test` hands the same books to both and requires the same
answer.

## The Book, format 2

**A book declares the lowest format that draws it.** `formatOf(book)` returns 2 once a book clips
a group, carries `symbols` or uses one, and 1 for everything else. Heirloom does none of those, so
it is still a format-1 book and not one byte of it moved when format 2 arrived. `validateBook`
refuses a book whose declared format and drawn format disagree, either way round: a book that
clips but says format 1 would be drawn half-right by an older painter, and one that says 2 while
drawing with nothing new would be hidden from an app that could have drawn it perfectly.

Format 2 adds one key to the book, one key to `group`, and one item. Everything format 1 has means
exactly what it meant.

```
{ format: 2, ...,
  symbols: { <id>: { items: [ ... ] } } }        // art authored once, drawn many times
```

| item | fields | notes |
|---|---|---|
| `group` | `items [tf] [clip] [op]` | `clip` is an absolute path `d`, filled nonzero, in the group's **own** coordinates: inside `tf`, not outside it |
| `use` | `ref [tf] [fill] [op]` | `ref` names a symbol in `book.symbols`; `tf` is an affine `[a b c d e f]`; `fill` is silhouette mode, a solid `#rrggbb`; `op` is one layer |

**Symbols** are how art is drawn many times without being written many times: a lamp, a frame, a
motif. The composer names each one and the painters keep them.

- A symbol holds shapes only: `rect`, `circle`, `path`, `group` and `use`. Not `text`, because a
  symbol cannot know which font role it would be printed in, and not `image`, which belongs to one
  person.
- A symbol may use another symbol, up to `MAX_SYMBOL_DEPTH` (four) deep, so a compiled motif can
  be built from smaller ones. It may never reach itself. A cycle is a `validateBook` failure, not something a painter
  discovers by hanging.
- An id is `[A-Za-z0-9][A-Za-z0-9_-]*`.
- **A painter expands a `use` where it stands.** `svg.js` writes the symbol's items out inline and
  never emits `<use href="#id">`: the desktop joins every page into one file to print it, so a
  symbol that kept its id would meet a copy of itself on the next page. Android concatenates the
  `use`'s transform and draws the symbol's items, parsing each path once into a cache keyed by the
  path data.

**Silhouette mode.** Ankit's rule, decided 2026-09-21. The design system's paper shadow is "the
same shape, offset" (`docs/book-design-system.md`), so a silhouette changes the colour of a symbol
and nothing else:

- `fill` on a `use` must be a solid `#rrggbb`. A gradient ref is a `validateBook` failure.
- Every fill **and** every stroke inside the symbol takes that colour, all the way down: through
  its groups, through nested `use`s (whatever `fill` they carry of their own), and through
  gradient fills, which become the solid colour.
- Everything else is kept. A stroke keeps its `sw`, `dash`, `cap` and `join`. A stroke-only item
  stays stroke-only (it is not filled), and a fill-only item stays fill-only (it gains no stroke).
  An open stroked string casts a line, and a ring frame casts a ring, not a disc.
- Opacities inside the symbol, on an item or on a group, are kept exactly as they are.
- The `use`'s `op` applies to the silhouette as a whole, as one group alpha (below). Shapes that
  overlap inside the shadow do not darken where they meet.

**A `use`'s `op` is one layer,** exactly as a group's `op` is: the symbol is drawn at full
strength and then composited once at `op`. `svg.js` puts the opacity on the `<g>` that wraps the
expanded items and never on the items themselves; Android draws it inside `saveLayerAlpha`, as it
draws a group. This holds for a plain `use` and a silhouette alike.

**Coordinates inside a symbol.** A `use`'s `tf` is concatenated first, and the symbol's items are
drawn in the coordinates that leaves. A user-space gradient that fills an item inside a symbol is
therefore in the **symbol's** coordinates, after the `use`'s `tf` (and after any group `tf`
inside the symbol), not in page coordinates: the same gradient moves and turns with each use.
`units: 'item'` gradients are relative to their circle, as always.

**Missing refs.** `validateBook` refuses a `use` whose `ref` is not a symbol the book carries, and
a fill whose `ref` is not a gradient in `defs`. Both are own keys only: `ref: 'constructor'` is an
unknown symbol, never something the object's prototype lends it. A painter may assume every ref it
is handed resolves. `svg.js` still throws on one that does not, rather than draw a gap, and
Android may do the same; neither draws a page around a missing piece.

**Limits.** Both are constants exported by `format.js`, and `svg.js` reads the same ones.

- `MAX_SYMBOL_DEPTH = 4`: a `use` on a page may reach at most four symbols deep. The symbol it
  names counts one and every symbol that symbol uses adds one, so a chain `a → b → c → d` draws
  and a fifth is refused, by `validateBook` and by the painter alike. A cycle is refused too.
- `MAX_EXPANDED_ITEMS = 20000`: the most items one page may draw once every `use` is expanded,
  counting each item, group and `use` as one. Symbols multiply (four levels of forty uses is 2.6
  million items), and a rich storybook page comes to a few thousand, so the cap is several times
  what any real page needs and far below what hangs a painter.

**Never write empty symbols.** A book either carries a `symbols` map with at least one symbol in it
or has no `symbols` key at all. `symbols: {}`, `null` or an array is refused: an empty map would
declare format 2 for nothing and hide the book from an app that could draw it.

**Clips.** A clip is one path, in the group's own coordinates, filled nonzero — no even-odd, no
second path, no clip on anything but a group. A painter clips inside the group's transform: save,
concat, clipPath, draw. A group's `op` is applied over the clipped result. Every clip edge must be
covered by a frame stroke somewhere in the drawing chain, because Android's preview can draw a
bare clip edge jagged.

The clip's path data (and every `path`'s `d`) follows one grammar, which `validateBook` parses:

- it starts with `M`;
- the commands are absolute `M L H V C Q Z` only, separated by spaces or commas or nothing;
- each command takes whole sets of its arguments — `M`, `L` two numbers, `H`, `V` one, `Q` four,
  `C` six, `Z` none — and may repeat the set (`L1 1 2 2`), as SVG and Android's `PathParser` both
  read it;
- numbers are decimal, optionally negative, optionally with an exponent, and finite;
- a clip must visit at least three distinct points (end and control points), so it encloses an
  area. `M0 0`, `L10 10 Z` and `e` are refused. A `path` may be open, or empty (`""` draws
  nothing).

**The conformance book.** `site/book/golden/format2-conformance.json` is a format-2 book drawn
with everything format 2 adds: an arch clipped over a photograph with a frame stroke over the clip
edge, one lamp drawn many times across its pages, a `use` turned by `tf`, a `use` dimmed by `op`,
clips on transformed and dimmed groups, and a silhouette of an open string, a ring and two
overlapping shapes under one dimmed `use`, so the silhouette rule is provable from the file alone.
`format.test.mjs` walks the file against a checklist of every format-2 feature, so an edit cannot
silently drop one. Both painters are held to it — `format.test.mjs` paints it as SVG, and the Android
tests read the same file — so it is the one place to change when format 2's meaning changes. It is
written by hand, not generated: `UPDATE_GOLDEN=1` does not touch it.

## What a PDF weighs

The book screen says *About 3.4 MB* before anybody waits for the PDF. `estimateBytes` (compose.js)
is that number, and the budget test holds every book under 10 MB with it. It errs toward "too big".

- **Fonts and pages:** 420 KB plus 18 KB a page.
- **Photographs:** 0.22 bytes a pixel as JPEG (desktop), 1.8 lossless (Android's `PdfDocument`).
- **Paper-cut art (format 2 only, #245).** Format-1 books keep the estimate they had, which
  already covers their starfields. For a format-2 book, `artStats(book)` counts what its drawing
  is made of, with every `use` expanded, because a symbol drawn forty times is forty copies in the
  PDF. The term is `ART_PDF` times those counts:

  | count | what it is | bytes each |
  |---|---|---|
  | `bytes` | every path's data, plus 40 for each shape, group and use (words and photographs left out) | 0.75 |
  | `translucent` | shapes with an opacity (a paper shadow is one) | 1,050 |
  | `gradients` | shapes painted with a gradient: a shading, and a soft mask if it fades | 5,800 |
  | `clips` | clipped groups | 1,600 |
  | `layers` | groups and uses with an opacity | 0 (measured free: the cost is in what they hold) |

**How it was measured,** 2026-09-22, with `tools/book_pdf_size.mjs` in Chromium 151:

1. The samples:
   - the six approved style frames and the design-system sheet, converted item for item from the
     kit's SVG into format-2 Books that pass `validateBook`;
   - the four pages of the conformance book;
   - five calibration pages, each loaded with mostly one kind of cost.
2. Each page was printed the way the desktop prints (the same HTML, `@page` A4, `page.pdf` with
   `printBackground` and `preferCSSPageSize`), then printed again with only its text. The
   difference is what its art cost.
3. The five counts were fitted to that cost by non-negative least squares on relative error.
4. The fit was scaled by its own 95th-percentile under-estimate (among pages with at least 18 KB
   of art; the per-page constant already pays for less) and by a quarter again: 1.95 in all. The
   result was rounded up.

On every page measured, the term plus the per-page constant allows between 1.40 and 15 times
what the art cost. The numbers are in `site/book/qa/pdf-size.json`, and `estimate.test.mjs`
fails if a constant drops below them.

| page | PDF | art in the PDF | art `bytes` | translucent | gradients | clips | term | allowed / cost |
|---|---|---|---|---|---|---|---|---|
| frame: cover | 857 KB | 845 KB | 711 KB | 1003 | 45 | 0 | 1817 KB | 2.17 |
| frame: opening | 565 KB | 548 KB | 501 KB | 634 | 21 | 5 | 1153 KB | 2.13 |
| frame: courtyards | 664 KB | 645 KB | 418 KB | 735 | 22 | 2 | 1195 KB | 1.88 |
| frame: lane | 821 KB | 803 KB | 434 KB | 809 | 35 | 0 | 1354 KB | 1.71 |
| frame: register | 696 KB | 676 KB | 251 KB | 873 | 41 | 23 | 1351 KB | 2.03 |
| frame: remembrance | 424 KB | 406 KB | 523 KB | 352 | 17 | 2 | 853 KB | 2.14 |
| frame: system | 404 KB | 384 KB | 378 KB | 384 | 13 | 12 | 770 KB | 2.05 |
| conformance 1 | 8 KB | 1 KB | 1 KB | 0 | 0 | 1 | 2 KB | 15.49 |
| conformance 2 | 17 KB | 7 KB | 2 KB | 1 | 2 | 1 | 16 KB | 4.77 |
| conformance 3 | 52 KB | 45 KB | 2 KB | 0 | 7 | 2 | 45 KB | 1.40 |
| conformance 4 | 16 KB | 9 KB | 1 KB | 0 | 0 | 0 | 1 KB | 2.02 |
| paths | 291 KB | 291 KB | 602 KB | 0 | 0 | 0 | 452 KB | 1.62 |
| dimmed paths | 449 KB | 449 KB | 602 KB | 400 | 0 | 0 | 862 KB | 1.96 |
| paper shadows | 449 KB | 448 KB | 618 KB | 400 | 0 | 0 | 874 KB | 1.99 |
| fading glows | 209 KB | 209 KB | 3 KB | 0 | 80 | 0 | 455 KB | 2.27 |
| dimmed uses, clips | 105 KB | 105 KB | 257 KB | 0 | 0 | 40 | 256 KB | 2.61 |

**What this means for the storybook.**
- **The style frames are far too heavy to ship as they are drawn.** A frame's art prints at 380 to
  850 KB. A 28-page book at that density, which the tool also prints, came to **18.6 MB** of PDF
  and 8 MB of Book JSON, against 10 MB and 1.5 MB. Its estimate is 36.7 MB. **The storybook's
  pages must be far lighter than the frames as drawn** (#253–#258).
- **The budget for art.** To stay under 10 MB, a 28-page storybook's art term has to stay under
  about 9 MB: roughly 330 KB of term a page, or about 170 KB of real art. The byte budgets in
  `art/README.md` (a scene ≤ 40 KB, an avatar ≤ 2.5 KB, drawn as symbols) are what get it there.
- **Paper shadows are the cost to watch.** Every shadow is a translucent shape, and the frames
  draw about a thousand of them a page.

**Android.** `PdfDocument` cannot draw format 2 until #246, so everything above is Chromium's
PDF. #246, and #259 on the finished Diwali book, must measure Android's PDF of the same pages
(`tools/book_pdf_size.mjs` writes the Books it prints), and raise `ART_PDF` if Android writes
more. The estimate is only as high as its highest painter.

## Fonts

Four static files embedded in the release, all covering Latin and Devanagari in one face:
`book_display` (Rozha One), `book_text` (Mukta Light), `book_strong` (Mukta SemiBold) and
`book_hand` (Kalam Regular, #242 - the handwritten voice for captions, notes, quotes and kin
words). They live in `app/src/main/res/font/`, which the desktop package copies too. See
[fonts.md](fonts.md). They are static rather than variable because Skia's PDF backend, used by
both Chromium and `PdfDocument`, writes variable fonts as Type3 outlines, which can't be selected
or searched. `Book.fonts` is an open map, so `book_hand` needed no format bump to join the other
three.

## Templates are data

A template is a JSON document (`site/book/templates/`) that chooses:

- a palette;
- three font roles from the embedded files;
- which pages, in which order (`cover` first, always);
- a cover motif, `stars` or `lamps`;
- optional ornaments (`lanterns`, `rangoli`);
- a few lines of cover copy with placeholders: `{family}`, `{from-family}`, `{count}`,
  `{count-words}`, `{Count-words}`.

`template.js` refuses anything else: an unknown key, a colour that isn't `#rrggbb`, a block it
does not know, markup in the copy, a newer `format`. Templates ship inside the release today. The
same rules are what make an on-demand download (#214) safe to add later.

| template | look |
|---|---|
| `heirloom` | Night sky: the family as a constellation, eldest at the centre, each generation an orbit further out |
| `diwali` | The same sky with every person a lamp, a rangoli ring, hanging lanterns, *शुभ दीपावली* |

### The catalogue

`templates/catalog.json` lists the templates a release offers, in order. Each entry has `id` (the
file is `templates/<id>.json`), `name`, the template `format` it needs, the `tier` the policy
switch matches on, and optional `featured` windows, one per year, both days included:

```json
{ "id": "diwali", "name": "Diwali", "format": 1, "tier": "free",
  "featured": { "2026": ["2026-10-18", "2026-11-15"], "2027": ["2027-10-08", "2027-11-05"] } }
```

- **Listed all year, featured in season.** Inside a window the template is listed first, marked
  *This season*, and the book opens on it. Outside, it keeps its catalogue place. A year with no
  window is not featured. That is how the list runs out, and nothing fails. A window may cross the
  new year. Diwali's windows run from three weeks before the festival to a week after. They are
  written up to 2030 and need extending before then.
- **Every opening starts on the day's choice.** Neither shell remembers the last template picked.
  The book opens on what is in season, otherwise the first template.
- **Newer formats stay hidden.** An entry whose `format` is newer than the composer reads is left
  out, so an older app never offers a book it would draw half-right. An entry that cannot be read
  is dropped on its own, and a missing template file is skipped.
- **One rule, two ports.** `catalog.js` and Android's `BookCatalog.kt` are held to one table,
  `catalog-cases.json`. Neither reads a clock: the shell passes the reader's local date in.

To add a template: add its file, add one entry here, and add a case to `catalog-cases.json` if it
has a season. No screen changes.

## What the composer promises

- **Deterministic.** No clock (`options.now` is required), no locale (names sort by a fold of
  their own characters, and Devanagari keeps its vowel signs), no randomness (the starfield is
  seeded by the family's name), coordinates rounded to 0.01 pt. The same tree gives the same bytes
  in node, Electron and an Android WebView. `golden.txt` holds a hash for every fixture and
  template.
- **Private by default.** The departed keep every date on record. The living show only the year
  they were born, unless the reader switches on full dates. No page gives a living person an age:
  the longest life on the numbers page is searched for among the departed only.
- **Honest.** Every mark in the constellation is one person, and every figure on the numbers page
  is counted from the record. People with no link to the main family are kept, in a section of
  their own, but not given a generation number that would claim a relationship.
- **Synchronous and headless.** No DOM, timers or animation frames. A WebView that is not
  attached to a window fires none of them.

## Pages

| block | what it is |
|---|---|
| `cover` | The chat thumbnail: the family's name, the constellation, one sentence. Legible at 150 px wide |
| `tree` | Everyone joined to the family, from the viewer's layout. With less than about 44 pt between people, names would fall under 6 pt, so the page becomes a night silhouette and the names move to the generation pages |
| `numbers` | A star chart plotted on time (across: year of birth, down: generation), then up to six facts |
| `generations` | Generations flow like chapters. One starts where the last ended if two of its rows fit, and never leaves a lone row to carry over. Portraits grow as a generation shrinks, and grow again when a generation has a page to itself. A page that ends early closes with a tailpiece, a short gold rule with the template's mark |
| `find` | *Find yourself*: every named person with their page, in three columns. Left out below six names |
| `closing` | *Is someone missing?*, the edition's month, and the QR code to the website |

## Story planner: circles

`site/book/story/kin.js` (#250) places everyone in scope into the featured person's circles.
The story planner (#251) calls `kinOf(family, featuredId, { words })` once per book. It is not
reached from `compose.js` yet, so no format-1 book changes.

**Claim order.** Each person gets exactly one circle, and the first claim wins:

1. self
2. parents
3. spouses: current, former or late, by `spouseLabel`'s rule
4. children, grouped by the other parent
5. siblings: full, half (grouped by parent set), and explicit links followed transitively
6. grandparents, per side
7. descendants
8. ancestors beyond the grandparents
9. branches: one per aunt or uncle, with their spouses, the cousins and the cousins' families
10. in-laws: one marriage from the core
11. lane: everyone else joined to F
12. elsewhere: people in scope the record does not join to F

**Each entry** is `{id, circle, role, side, gen, branch, via, namedBy}`:
- `side` is paternal, maternal or none.
- `gen` is the generation offset from F.
- `branch` is the group key within the circle.
- `namedBy` is `{id, word}` for a person with no name, so they can be called "Shyam Lal's wife".

Each `circles[c]` is sorted deterministically, by side, then branch (eldest first), then
generation, birth year, name and id. The code's header comment has the full table of roles and
branch keys.

**Words.** `words(id)` returns `{en, hi, term, word, through}`. `through` is set, and `en` is null, where the relation runs through one marriage: `{kind: 'married-to' | 'of-spouse', term, id}`, which copy.js (#252) phrases the way the desktop's `sentenceFor` does ("married to Ankit's cousin", never a possessive chain).
- People one step from F take the app's label rules (`parentLabel`, `spouseLabel`,
  `childLabel`, `siblingLabel`).
- Everyone else takes `relate()`'s term with `hindiTerm` and `hindiWord`. `relate()` runs once
  per person asked about, and never for the partition itself.
- Parents are पिताजी / माँ.
- A former spouse or a partner has no Hindi word, so the English one is used.

## Options and the allowance

`options`: `now` (required), `scope` (`{kind:'everyone'}` or `{kind:'branch', personId}`, the same
cut as sharing a branch), `title`, `photos`, `livingDates`, `words` (`'en'` or `'hi'`, the reader's
Family-words setting), `featured` (a person id, or left out to let `resolveFeatured` choose),
`notes` (off by default) and `coverOnly`. The last four are read by the storybook's story pages
(#256-258) and `resolveFeatured`/`family.js`'s `note` field today; no format-1 block reads them yet,
so sending them changes nothing about what Heirloom or the current Diwali draws. Android sends all
four as of #248; the desktop equivalent is #249.

`allowance` is what the policy switch (#156, [premium.md](premium.md)) granted. Today it is always
empty, which means everything. `maxGenerations` keeps that many generations from the eldest down;
`attribution: false` leaves out the f-tree credit. Both are tested, so the day a policy uses them
is a policy change, not a composer change.

## The book screen, the same on both shells

**Where it opens from.**

- The whole tree:
  - Android: a book icon in the chart's action row.
  - Desktop: a toolbar button, and **File › Make a family book…** (Ctrl+P).
- One branch: **Family book from {first name}** in a person's actions (Android's person sheet,
  the desktop's person panel). That opens the screen with *Who* already set to that person's
  branch.
- With nobody in the tree, the entries are disabled and say why: *Add someone to the tree first*.

**What it shows**, top to bottom on a phone, and as preview-left and options-right on a wide
window:

1. **The preview is the book.** Android shows the pages the PDF is drawn from, one at a time, with
   *Page 3 of 10* beneath. The desktop shows them as a scrolling column.
2. **Template.** One choice per catalogue entry, each showing a small cover drawn with the reader's
   own family. A seasonal template shows *This season* inside its window.
3. **Title.** Starts as the derived title (*The Sharma Family*). It can be edited, and Devanagari
   works. *Reset* appears once it has been changed.
4. **Who's in it.** *Everyone* or *{Name}'s branch*. The second is offered only when the screen was
   opened from a person.
5. **Whose story.** A picker over the book's current scope, prefilled with the composer's own
   choice - *Chosen for you: {name}* - until the reader picks somebody, with a *Reset* back to
   that default once they have. On a template that does not tell one person's story (Heirloom),
   the row stays rather than hiding, with a line saying so: *Heirloom doesn't feature one person
   yet.* The control is generic on every template even though only the storybook (not yet shipped)
   reads it.
6. **Include notes**, off by default. Its helper line says why: a note is the family's own words,
   and a book like this can be forwarded to people nobody chose.
7. **Photographs**, with the estimate beside it: *About 3.4 MB*.
8. **Full dates for living people**, off by default. Its helper line: *When off, living people show
   only the year they were born.*
8. **Include notes**, off by default. Its helper line says what a note is and why it stays out
   unless asked for: the family's own words, written for someone in particular, and this book may
   be forwarded to people who were never chosen to read them (`family.js`'s `clampNote`).
9. **Family words.** Not a control on this screen -- the app's own *Family words* setting
   (English/हिन्दी) is read once and passed through as `options.words` on every book, the same
   setting the relation finder already reads for its own Hindi kinship terms.

Photographs, Full dates and Include notes are each a switch on Android and a checkbox on the
desktop. That is deliberate, not a drift to fix: each is its platform's own idiom for a setting
that applies at once.

**Whose story, the picker and the Family-words setting (#248, Android; #249, desktop).** The picker
sharing code with the relation sheet's own ("who are we related to") search - one implementation,
so a fix to how picking somebody works reaches both. It offers only people in the book's current
scope: everyone, or the branch, matching *Who's in it* above. The reader's Family-words setting
(Settings › Family words) reaches the book the same way it already reaches the relation sheet and a
person's page - there is no separate control for it here.

**Actions.**

- Android: **Share** (primary, the share icon, the same button the relationship card uses) and
  **Save to device** (the system's save dialog).
- Desktop: **Save PDF…** (primary). When it's done, a toast says *Saved "{file name}"* and offers
  **Show in folder**.

Both actions ask the policy switch first. Today it always answers yes. Only a successful save or
share is counted.

**While it works.** *Making your book…*, with the controls held still so nothing changes under
the reader's hand.

**If it fails.** The message says what failed and what to try, never "something went wrong".
Android names the missing System WebView if that is the cause, and offers **Try again** when the
renderer stopped or ran out of time. A layout failure offers **Copy details**: the error and the
versions involved, put on the clipboard and sent nowhere, for the reader to add to a report.

**Accessibility.** Every page preview carries its label (*Page 3 of 10: The second generation*),
progress is announced, and every control is reachable by keyboard and screen reader.

## Working on it

- `node --test site/book/*.test.mjs` runs the tests. Regenerate the goldens with `UPDATE_GOLDEN=1`
  once a change is meant.
- Serve the repository root (`python3 -m http.server`) and open `/site/book/preview.html` to see
  every template with every fixture, painted by the SVG painter the desktop prints with.

### The QA harness (#245)

- **Fixtures.** `site/book/fixtures/` holds the hand-written fixtures and the storybook's
  synthetic ones (`story-*.json`: a family of 200 over six generations, F as the eldest and as a
  leaf, a remarriage with half, step and explicit siblings, twelve siblings, three spouses, an
  unlinked F, lost names, hostile notes, Devanagari, a tiny family and an empty tree).
  - The synthetic ones are generated, never edited:
    `python3 tools/make_sample_tree.py --book-fixtures site/book/fixtures`.
  - `storybook.json` says what each one is and names the people a test can look for (`f` is F).
  - CI runs `--check-book-fixtures` and fails if the committed files drift from the generator.
    Other issues' tests name these people, so add a fixture rather than change one.
- **The report.** `composeWithReport(doc, options, template, allowance)` returns the same book as
  `composeBook` plus `{ shown, textBoxes, artZones, minSize, pages }`. Story pages feed it through
  `ctx`:
  - `ctx.show(id)` for everyone a page names (`ctx.portrait` already does);
  - `ctx.zone('text' | 'face' | 'busy', box)` for where the art allows words;
  - `ctx.describePage({ archetype, variant, people, density })`;
  - `kind: 'body' | 'name' | 'caption' | 'ornament' | ...` on `ctx.line` and `ctx.lines`.

  Each is a no-op when nobody asked for a report.
- **The invariants.** `site/book/invariants.test.mjs` runs `qa/invariants.mjs` over every fixture,
  every template the composer can draw, and three featured people (the most connected, the eldest
  and a leaf).
  - The storybook joins automatically once a format-2 template composes. Until then its test is
    skipped, with the reason.
  - A flag test fails if a story composer lands with no template to run it over, or if its pages
    don't report their zones, archetypes and kinds.
  - Format-1 books are held to what they promise. The tree page prints the years under each
    name at 6.4 pt, under the storybook's 7 pt floor, and Heirloom's output is frozen, so format 1
    is grandfathered at a 6 pt floor. Variety and the density caps are storybook rules and don't
    apply to it.
  - Lines the checks treat differently say so with `kind`: Heirloom's generation numeral is
    `'ornament'` (left out of the collision checks), and the numbers page's longest life is
    `'lifespan'` (the one "N years" a book may print).
- **The contact sheet,** for the by-eye review. It is not run in CI, and it needs Playwright
  (`npx playwright --version`) and its Chromium:
  ```
  FTREE_PLAYWRIGHT=<.../node_modules/playwright/index.mjs> node tools/book_contact_sheet.mjs <out-dir> [fixture ...]
  ```
  It writes one PNG per fixture (a row per template, every page labelled), each cover at 150 px
  wide, and an `index.html` of the lot. Look at the covers at that size: they are the chat
  thumbnail.
- **PDF weight.** `tools/book_pdf_size.mjs <out-dir>` re-measures the art term, the same way
  (see *What a PDF weighs*).
