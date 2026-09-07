# Changelog

All notable changes to f-tree. Each entry links to the full release notes and the APK.

Versions follow [Semantic Versioning](https://semver.org/). A tag with a `-beta.N` suffix is
published as a GitHub pre-release and reaches only people who have opted into the beta channel; the
betas leading up to a stable release are folded into that release's entry here.

---

## [0.7.0](https://github.com/thisisankit27/f-tree/releases/tag/v0.7.0) — 2026-09-07

**Ask how two people are related from the chart that answers it, and turn the whole thing sideways.**

- The relation finder can be reached from the chart, which then draws just the line between the two
  people rather than lighting it up inside the whole family.
- Every descent bar is connected, and the lines themselves take part in a selection.
- **Both charts turn on their side.** On a short window the destinations move to a navigation rail
  and the chart's title bar, mode switch and actions fold into one row — about 140dp given back to
  the drawing, which on a real family is two more generations on screen.
- Panning is clamped against the chart that is actually on screen, fixing a stale clamp that let a
  freshly re-laid-out chart be dragged out of view.

## [0.6.0](https://github.com/thisisankit27/f-tree/releases/tag/v0.6.0) — 2026-09-07

**Send one person's family rather than the whole archive.**

- **Share a branch.** Tap somebody and send their household — their partner, their children, and
  everyone below them — as a small `.ftree`. The people *above* them stay behind.
- **Send a relationship as a picture.** Chat apps quietly drop the message that comes with a
  document but show it beside an image, so an answer can travel as a card in the app's own notation
  rather than as a screenshot.
- **Open a family tree somebody sent you** directly from the chat app.
- A beta channel, at the bottom of Settings, behind a warning and a dialog.

## [0.5.2](https://github.com/thisisankit27/f-tree/releases/tag/v0.5.2) — 2026-09-07

- Adds the **beta releases** switch. Nothing else changes — this is 0.5.1 with the switch added, so
  that anyone who wants to help test the next version can reach it.

## [0.5.1](https://github.com/thisisankit27/f-tree/releases/tag/v0.5.1) — 2026-09-07

**Four things a careful pass turned up, three of them the app quietly not doing what it said.**

- The words under an empty heading — *"Add a parent"* — are now the button, not decoration.
- The delete dialog reads in the order you decide, with Cancel at the foot rather than sitting
  between the two real choices.
- A chart can no longer be dragged off its own page; panning keeps the middle of the screen over
  the chart, and a control puts a chart back on its family.
- At a large text size a lifespan rendered as *"1905–197"* — a wrong date, not a clipped label.
  Cards now grow with the reader's setting.

## [0.5.0](https://github.com/thisisankit27/f-tree/releases/tag/v0.5.0) — 2026-09-06

**Compact — a third way to look at your tree, for anyone who would rather not pinch a canvas.**

- Generations run down the page, oldest at the top, each headed by a ruled label with its count.
- **A tap moves you.** No back button and no history, because every walk is undone by one tap in
  the row it came from.
- Compact and Chart share one centre, so switching never loses your place.
- The mode switch reads **Compact · Chart · Everyone**.
- In landscape the cards turn on their side: four generations in view where there were two.

## [0.4.0](https://github.com/thisisankit27/f-tree/releases/tag/v0.4.0) — 2026-09-06

**Relationships named in Hindi.**

- Turn on *Family words → हिन्दी* and the app names relationships the way the family does: your
  mother's brother is **मामा**, your father's younger brother **चाचा**, his wife **चाची**.
- A word is claimed only when the record earns it: ताऊ is an elder brother and चाचा a younger one,
  so with no birth years the app says पिता के भाई and offers to sharpen it.
- Hindi falls back to English where it genuinely has no word, because that is what Hindi speakers do.

## [0.3.0](https://github.com/thisisankit27/f-tree/releases/tag/v0.3.0) — 2026-09-06

**Faces on the chart, and a landscape that is mostly chart.**

- Every card carries a circular portrait — the square you framed, or the person's initial on a
  ground coloured by gender.
- Photographs can be switched off on a very large tree without a single card moving.

## [0.2.2](https://github.com/thisisankit27/f-tree/releases/tag/v0.2.2) — 2026-09-06

**"Related by marriage" is gone.**

- The relation finder names relationships that run through a marriage: an uncle's wife is an
  **aunt**, a wife's mother a **mother-in-law**, a father's second wife a **stepmother**.
- Where English has no single word it still says who somebody married — *"married to Ankit's first
  cousin once removed"* — rather than inventing one.
- On a real 148-person tree this took the share of named pairs from 31% to 55%.

## [0.2.1](https://github.com/thisisankit27/f-tree/releases/tag/v0.2.1) — 2026-09-05

**The whole-tree chart was drawing real families wrongly.**

- A generation is a relative fact, not a depth. Ranking people by their longest path down from the
  oldest ancestor made a person's row depend on how far back *their* ancestry happened to be
  written down. A child now sits exactly one row below each parent, and spouses and siblings share
  a row.
- On the reported 148-person tree, all 176 parent edges now span exactly one row, and no set of
  siblings or couple is split.
- A traced relation draws only the line, rather than fading a hundred and forty people who are
  still on the page.

## [0.2.0](https://github.com/thisisankit27/f-tree/releases/tag/v0.2.0) — 2026-09-05

**The first release you will not have to install by hand.**

- **In-app updates, off until you turn them on.** f-tree checks GitHub for a new version and
  installs it over the top, so your tree stays where it is.
- Before installing anything it checks the SHA-256 against the digest GitHub published, the package
  name, and **that it is signed by the same key as the copy you already have**.
- Opt-in in the code, not just in the settings screen: with the switch off the app will not open a
  socket. `update/` is the only package that can reach the network at all.
- The whole tree on one chart.

> Because of the signing check, this is the one upgrade that still has to be done by hand.

## [0.1.1](https://github.com/thisisankit27/f-tree/releases/tag/v0.1.1) — 2026-08-31

- Licensed under [MIT](LICENSE).
- Signed releases built and published from a tag by CI.

## [0.1.0](https://github.com/thisisankit27/f-tree/releases/tag/v0.1.0) — 2026-08-30

**The first installable build** — a local-first family tree for Android.

- People, with almost nothing required. A blank person is a valid *unknown person*.
- A graph, not a tree: multiple spouses, children across marriages, half-siblings and unknown
  ancestors, with no special cases.
- A focused family chart — ancestors above, descendants below, pan, zoom, tap to re-centre.
- Export and import as a single `.ftree`, with merge semantics that never overwrite. A backup is
  saved before every import.
- Photos, kept inside the app and carried in the export.
- Dark mode, and layouts that hold up at the largest system text size.
