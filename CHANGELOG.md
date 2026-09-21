# Changelog

All notable changes to f-tree. Each entry links to the full release notes and the APK.

Versions follow [Semantic Versioning](https://semver.org/). A tag with a `-beta.N` suffix is
published as a GitHub pre-release and reaches only people who have opted into the beta channel; the
betas leading up to a stable release are folded into that release's entry here.

---

## [Unreleased]

**The family book on Android draws book format 2, and never drops a line of text in silence (#246).**

- **Clipped arches, reusable art and paper shadows** — the drawing vocabulary the coming storybook
  templates need — are now drawn on Android exactly as the desktop draws them. Nothing an existing
  book prints changes: Heirloom and Diwali are still format-1 books.
- **A book naming a typeface this app does not carry is refused, with the name,** instead of being
  printed with that line of text missing. The error says which face, which ones the app has, and to
  update f-tree.

**Whose story a family book tells, and its own words in it (#248).**

- **"Whose story", on Android.** The book screen now asks who to tell the story around, prefilled
  with the composer's own choice ("Chosen for you: …") until you pick somebody yourself, from
  everyone in the book's current scope. Reset returns to that default.
- **Include notes — off by default.** A note is the family's own words, and a book like this can be
  forwarded to people nobody chose, so it stays out of the book unless you turn it on.
- **Speaks your Family-words setting.** Whichever language you chose for kinship terms in Settings
  now reaches the book too.
- **Heirloom says why it can't yet.** Heirloom draws the whole family as one constellation with
  nobody at its centre, so both new controls stay visible there with a note explaining why they
  do not change anything on that template yet.

**Choosing whose story a family book tells, on desktop (#249).**

- **"Whose story"**, in the family book dialog: a search picker over whoever is currently in
  scope, prefilled with *Chosen for you: {name}* — the same person the book would already be told
  around — with *Reset* to go back to it after picking somebody else. Keyboard-accessible: arrow
  keys move through the matches, Enter picks one, Escape closes the list without closing the
  dialog. On Heirloom, and every other template that does not yet build a page around one person,
  it says so: *"Heirloom doesn't feature one person yet."*
- **"Include notes"**, off by default. A note is the family's own words, written for someone in
  particular, and a book may be forwarded to people who were never chosen to read them — so it
  stays out unless asked for, with a helper line saying why.
- **Family words** now reaches the book: a household that reads relationships in हिन्दी gets the
  same choice in what it prints.
- **Faster template previews.** Switching templates in the dialog no longer composes every other
  template's whole book just to draw its thumbnail — each non-selected cover now stops at its own
  first page.

**Whose birthday is coming up, and a note on the morning if you want one (#230, #154).**

- **Coming up, on Android (0.10.0-beta.3) and desktop (0.8.0-beta.3).** The top of People lists the
  next 30 days: living birthdays with the age turned ("turns 60"), or just the day when no year is
  recorded. Below them, under **Remembering**, the birthdays and death anniversaries of those no
  longer with us. Nothing in the window? It says when the next one is.
- **Birthday reminders — off until you turn them on.** A note at nine in the morning, one a day
  however many share it, on the day or the day before. Remembrance days are a second switch, off by
  default. On a locked phone it says only "A birthday today".
- **Asks for nothing until switched on.** Android is asked to allow notifications at the moment you
  turn reminders on and at no other time; the permission list in Settings says so. The desktop
  reminds you while f-tree is open, and catches up when you next open it that day.
- **Nobody is left out in silence.** The switch says who it covers and who it cannot: "Covers 42
  people. 106 have no day and month recorded." 29 February falls on the 28th in other years, and
  nobody "living" is wished a happy 111th.
- **The updater can no longer be hidden by a desktop release.** GitHub had been calling desktop
  0.6.0 the repository's latest release, which left the phone's ordinary update check with nothing
  to install. It now falls back to the full release list when that happens.

**Dates you just type, and birthdays nobody remembers the year of (#90).**

- **Type a date as digits, on Android (0.10.0-beta.2) and desktop (0.8.0-beta.2).** The date
  field is three slots — `YYYY-MM-DD` — with the hyphens already there, and on a phone it opens
  the number pad. `19380417` is the whole gesture; no hunting for `-` behind a keyboard switch,
  which is what a user asked for.
- **A birthday without a year.** Leave the year empty and the day is kept as `17 April`; tap the
  year later to add it. Death dates work the same way. Stored as `--04-17`, the standard form, and
  files stay openable by every earlier version, which reads such a date as unknown.
- **The date is read back as you type it** — "17 April 1938" — which catches a month and day
  swapped. Mistakes are named ("April has 30 days") and wait until you have finished typing.
- Fixed along the way: a child with a yearless birthday was listed as the eldest; the family book
  could print "Born null"; duplicate matching now treats two birthdays that disagree as two people.

**A family book: the whole tree, designed and printable, made to be handed around.**

- **The family book, on Android (0.10.0-beta.1) and desktop (0.8.0-beta.1) — a beta feature.** A
  PDF built entirely on the device: a cover made from the family's own shape — designed to read at
  the size a chat app shows a document's thumbnail — everyone in the family, a page of facts about
  it, a generation at a time, an index that gives every named person their page, and a closing
  page with a QR code back to the site.
- **Two templates, one evergreen.** Heirloom, always available, and a Diwali edition —
  *शुभ दीपावली* — that moves to the front of the list and opens first in the weeks around the
  festival, and stays listed, just not featured, the rest of the year.
- **Private by default.** Living people show only the year they were born; a switch turns on full
  dates for them. People no longer with us always show their full dates.
- Names — a title, a family name, anyone's recorded name — print correctly in Devanagari, on both
  shells, from the same subset fonts.
- Android gets **Share**, the same button the relationship card uses, and **Save to device**;
  desktop gets **Save PDF…**, then a toast offering **Show in folder**.
- A file-size estimate and a hard budget keep a book with photographs small enough to still move
  through a chat app, on both shells.
- The groundwork for a policy switch (#156): one place that will decide what a reader may do with
  the book. Today it grants everything, to everyone, for free — see
  [the policy switch](docs/premium.md) for the principle this is built to keep: *gate
  presentation, never data*.

**Send a tree to a device you can see, without a cable or a cloud.**

- **Nearby sharing, on Android and desktop — a beta feature.** Two devices on the same Wi-Fi find
  each other, show the same six-digit code, and a `.ftree` goes straight across — no account, no
  server, and nothing in between. The receiver reviews what arrives in the same import screen a
  shared file already went through: matching, conflicts, add-never-replace, all unchanged.
- **QR quick-connect.** The receiving screen shows a code carrying a single-use, five-minute pairing
  token; scanning it skips typing the six digits. Typing an address always works, and always
  compares digits.
- Two protocol fixes made in review, before anything shipped: the receiver now commits to its key
  and nonce before the sender's are revealed, so a device in the middle cannot grind a matching
  code; and a QR pairing is now claimed only by the side that actually scanned one, so the ordinary
  six-digit path no longer broke while a QR happened to be on screen.
- Credit to **SUD77**, who wrote the protocol, both language cores, and the cross-language test that
  proves a Kotlin process and a Node process agree byte for byte.
- **Importing the same file again no longer adds anybody twice.** A file holding a stale copy of
  somebody — left by an earlier import that failed to recognise them — used to add a few more
  people on *every* import (#193). The two causes are fixed on both platforms: your own people
  are now recognised when a file of yours comes back through somebody else's tree (#194), and a
  copy and the person it copies are each matched to themselves. Each import also no longer saves
  another copy of every photograph (#195).

## [0.8.0](https://github.com/thisisankit27/f-tree/releases/tag/v0.8.0) — 2026-09-09

**See the photograph you saved, and get the whole screen back on a phone held sideways.**

- **Tap somebody's photograph to see it.** It opens whole rather than as a circle — the circle is a
  display decision and the file was never round, so for a photo that arrived in somebody else's tree
  this is the first time anyone sees what the circle was cutting off. There is deliberately no
  pinch-zoom: photos are stored at 512px on the long edge to keep a large family and its `.ftree`
  small, and offering the gesture would promise detail the file does not hold.
- **A wide window is used rather than left half empty.** People, Settings and a person's relatives
  now break into as many columns as the width deserves — one on an upright phone, two on a phone
  held sideways, three on a tablet — instead of one column of reading matter beside a band of
  nothing. A landscape phone shows six names where it showed three; a tablet shows twenty-one. The
  rule is that no column runs past a comfortable line length and none of the width is left over,
  which is the answer a typesetter gives to a page too wide for one column.

Everything from 0.8.0-beta.1 and beta.2, promoted unchanged.

## [0.7.1](https://github.com/thisisankit27/f-tree/releases/tag/v0.7.1) — 2026-09-07

- **The app icon is the mark from the website.** The launcher showed something different from the
  site's logo; they are now one mark.
- The README is a front door rather than a set of build notes, and the site's calls to action look
  like buttons.

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
