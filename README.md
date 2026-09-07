# f-tree

A lightweight, local-first Android app for keeping a personal family tree.

No account, no login, no backend, no cloud. One person keeps their own family graph on their own
device. Trees are shared by exporting a file — and **importing one merges it into yours rather than
replacing it**.

<!-- Screenshots live in docs/screenshots once a release is tagged. -->

## What it does

- **People, with almost nothing required.** A person needs no name, no dates, nothing. A blank
  person is a valid *unknown person* — the grandfather's brother whose name nobody wrote down — and
  can be named years later without disturbing a single relationship.
- **A graph, not a tree.** Multiple spouses, children across different marriages, half-siblings,
  adoptive and step relationships, and unknown ancestors all work without special cases.
- **Three views of the tree.** *Compact* reads a family as text — generations down the page, a tap
  to walk to anybody, no pinching and nothing that needs a steady hand. *Chart* draws the same
  people, with pan, zoom and tap-to-recentre. *Everyone* draws the entire tree at once — every
  generation, every household, and the people no relationship reaches, whom the other two have
  nowhere to put. Compact and Chart share one centre, so switching between them never loses your
  place.
- **A relation finder.** Pick any two people and f-tree names the relationship — "first cousin once
  removed", "great-great-grandfather" — and lists every person the line runs through, which is the
  form that can also answer the ones English has no word for. It walks marriages as well as blood,
  and will draw the line across the whole-tree chart.
- **Relationships in Hindi.** Turn on *Family words → हिन्दी* and the app names relationships the way
  the family does: your mother's brother is **मामा**, your father's younger brother **चाचा**, his
  wife **चाची**. Not a translation — Hindi has five words where English has "uncle", and picking the
  right one needs facts English discards. See [docs/kinship-hindi.md](docs/kinship-hindi.md).
- **Optional in-app updates.** Off until switched on. Checks GitHub for a newer release and installs
  it over the running copy, so a new version keeps your tree instead of costing an export and an
  import.
- **Export and import as a single `.ftree` file**, with merge semantics that never overwrite.
- **Share one person's family.** Tap somebody and send their household — their partner, their
  children, and everyone below them — as a small `.ftree` over WhatsApp or anything else. The people
  *above* them stay behind. The recipient imports it and it merges into their own tree, which is
  also how you graft a relative's branch onto yours: import it, then marry the two families together
  with one relationship.
- **Faces on the chart.** Every card carries a portrait, framed in a circle when the photograph was
  added and a coloured initial when it was not. Photographs can be switched off for a very large
  tree without a single card moving.
- **Photos**, stored inside the app and carried in the export.

## Build

Requires **JDK 17+** and the Android SDK (platform 37, build-tools 36).

```bash
./gradlew assembleDebug
```

`assembleRelease` produces an unsigned APK unless a `keystore.properties` exists at the repo root
(see [Releasing](#releasing)). The project always builds without it.

## Run

```bash
./gradlew installDebug
adb shell am start -n com.vibethroughcode.ftree/.MainActivity
```

Debug builds carry a seeder for development, so the chart and the merge logic can be exercised
without tapping through hundreds of forms:

```bash
# A deliberately awkward family: unknown ancestors, two marriages, half-siblings, missing dates.
adb shell am broadcast -a com.vibethroughcode.ftree.SEED \
    -n com.vibethroughcode.ftree/.debug.SeedReceiver --es mode family

# A large tree, for performance work.
adb shell am broadcast -a com.vibethroughcode.ftree.SEED \
    -n com.vibethroughcode.ftree/.debug.SeedReceiver --es mode large --ei size 2000

adb shell am broadcast -a com.vibethroughcode.ftree.SEED \
    -n com.vibethroughcode.ftree/.debug.SeedReceiver --es mode clear
```

The receiver exists only in debug builds.

## Test

```bash
./gradlew testDebugUnitTest          # pure logic: dates, graph rules, layout, matching
./gradlew connectedDebugAndroidTest  # database, transfer, and Compose UI flows (needs a device)
./gradlew lintDebug
```

## Architecture

```
data/       Room entities, DAOs, the repository, photo storage
graph/      pure graph logic: traversal, relationship rules, chart layout
transfer/   the .ftree format, export, import, duplicate matching
update/     the optional updater — the only code that touches the network
ui/         Compose screens, one package per area
```

Two rules shape the layout of the code:

1. **Anything worth reasoning about is pure.** The chart layout, the relationship rules and the
   duplicate matcher take plain data and return plain data — no Room, no Compose. They run off the
   main thread and are tested directly on the JVM, which is why the trickiest logic in the app is
   also the cheapest to test.
2. **No DI framework.** [`AppContainer`](app/src/main/java/com/vibethroughcode/ftree/AppContainer.kt)
   wires one repository by hand. For an app this size a compiler plugin would add indirection
   without removing any.

### Data model

A **graph of people and typed edges**, because real families are not trees.

`people` — every descriptive field is optional. A null name *is* the unknown-person mechanism.
Dates are partial ISO-8601 (`1938`, `1938-04`, `1938-04-17`), so nobody has to invent a day they do
not know, and no separate "approximate" flag is needed: the precision is the statement. Age is
derived, never stored. `photoId` is a bare file name, never a path, so a photo survives a reinstall.

`relationships` — `PARENT` (directed, parent → child), `SPOUSE` and `SIBLING` (symmetric). Symmetric
edges are stored in canonical id order, so a **unique index on `(from, to, type)`** makes duplicate
prevention a database guarantee rather than a race the app has to win. The type is persisted by
*name* with an `UNKNOWN` fallback, so a new relationship kind needs no migration and a row written by
a newer version is degraded rather than dropped.

`person_origins` — where an imported person came from. This is what makes a later import recognise
them with certainty instead of by comparing names.

**Siblings are derived** from shared parents in SQL rather than stored. They stay correct when a
parent is added later, and the graph never accumulates O(n²) redundant edges. An explicit `SIBLING`
edge exists only for siblings whose parents are unknown — the one case derivation cannot express.

### Relationship rules

Rejected at the point of creation, not defended against at every read: self-reference, a duplicate
edge, an edge that would make someone their own ancestor, and a parent who is also recorded as their
child's spouse or sibling.

### Deletion

Deleting asks *what happens to the connections*, not whether you are sure:

- **Keep as unknown** — clears the details but keeps the node and every edge, so losing one name does
  not tear a hole in the family.
- **Delete completely** — removes the person and, by cascade, their edges.

### The chart

Ego-centric on purpose. Laying out a whole family produces something no phone can show and no person
can read, so the chart draws one person's ancestors above and descendants below, siblings beside
them, and everything else is reached by re-focusing. Cousins and siblings' descendants are left out:
they multiply width far faster than they add meaning, and they are one tap away.

Only the neighbourhood is loaded, a generation at a time, one batched query per ring — so a tree of
thousands opens as fast as a tree of ten. Everything is painted into a single `Canvas`; pan and zoom
live in float state read *only inside the draw lambda*, so dragging re-runs the draw phase and
nothing else, and offscreen nodes cost a bounds check each.

Notation: marriage is a doubled rule, a couple's children hang from one connector while a
half-sibling hangs from their own, and a person with no name has a dashed brass edge — the gap is in
what the family remembers, not a fault in the record.

Every card opens with a circular portrait. With a photograph it is the square the reader framed;
without one it is the person's initial on a ground coloured by gender, so a chart of a hundred
faceless cards still reads as people rather than as a wall of identical discs. A person whose name
was never recorded keeps the dashed brass ring they have everywhere else. The disc is part of the
card at every zoom and whether or not photographs are switched on, which is what lets
**Settings → Photos on the chart** be turned off on a very large tree without anybody moving.

Photographs on a drawn surface have no `AsyncImage` to hang from, so `ui/tree/ChartPhotos.kt` is the
equivalent for a canvas: it asks only for the faces the viewport can see, decodes them off the main
thread at 160px in `RGB_565` — about fifty kilobytes each — and holds them in snapshot state, so a
face arriving re-runs the draw phase and nothing else. What is held is capped, so panning across a
thousand people trades faces in and out rather than accumulating them.

### Reading it instead of drawing it

Both charts are pictures. To read a name you pinch, to reach a relative you pan, and a canvas holds
nothing at all for a screen reader — which is why the chart describes itself and then points at the
people list. But that list is alphabetical and has no family in it. Between *a picture you must
zoom* and *a list with no shape* there was nothing, and **Compact** is that missing middle: the same
people the focused chart draws, composed rather than painted, so they can be read at any text size,
tapped with a thumb and spoken aloud.

Generations run down the page, oldest at the top, each headed by a ruled label carrying its count,
with the people laid across it — a row is how a generation is drawn everywhere, and side by side is
also what makes the view compact, since a column of full-width rows would show fewer people per
screen than the chart it exists to relieve.

**A tap moves you.** Touching anybody re-centres the whole view on them, and that is the only
interaction. It needs no back button and keeps no history, because every walk is undone by a single
tap in the band it came from: if she is now above you, you are now below her. The centre is a block
of its own rather than a card in a row, and tapping it opens the same sheet the charts open, so
there is one set of things you can do with a person rather than three.

`CompactFamily` (`graph/CompactFamily.kt`) is built from the layout the chart has **already**
produced, not from a second walk of the graph. The rules about who appears — ancestors, descendants,
the focus's siblings, everyone's partners, and deliberately not cousins or nieces — are subtle and
live in `TreeLayoutEngine`; deriving from its output means the two views cannot drift into showing
different families, and switching between them costs nothing because nothing is loaded twice. It is
pure data, so the awkward parts are tested on the JVM: who belongs to a generation by descent as
against who married into it, and where the doubled rule may be drawn.

That distinction is what the headings count. A step-grandmother is family and is shown, attached to
the grandparent she married — but she is not a fifth grandparent, and *Grandparents · 4* means four
grandparents. Someone who married twice is placed *between* their two spouses so the marriages read
along the row, and the rule is drawn only between people who actually wed: three people in one group
make two marriages, not three.

Absence is shown rather than hidden. A generation nobody has recorded still gets its heading and an
invitation to fill it in, exactly as on a person's page — an empty rule reads as "not written down
yet", which is the subject of this app, while a missing one reads as "not supported". Only parents
and children get that treatment: they are the two directions the view walks in, and four empty
headings would bury the family that *is* recorded.

Nothing here is a second notation. Marriage is the chart's doubled rule, an unrecorded name keeps
its dashed brass ring, and the years are the same span in the same monospace as everywhere else a
person is listed.

### Photographs

A picked photograph is always framed before it is kept. The window is a fixed circle and the picture
moves behind it, which makes the awkward case impossible: the picture can never be smaller than the
circle, so there is no way to frame a crescent of empty space and no error to explain. The sums are
in `ui/person/CircleCrop.kt`, kept free of any Android type so the part that can be wrong — which
pixels end up saved — is tested on the JVM rather than checked by eye.

What is stored is the square, not a circle: roundness is drawn by every place that shows a face, so
a round image would only mean carrying an alpha channel to save a shape we redraw anyway. It is kept
at 512px, which is sharper than any circle in the app can show even on a 4x screen, and costs about
twenty kilobytes a person rather than several hundred.

### Naming a relationship in another language

English kinship is two numbers: how many generations up to a shared ancestor, how many back down.
"Uncle" needs neither the side of the family nor a birth order, so `termFor(up, down)` throws both
away. Hindi needs them, and so does most of the world outside western Europe.

So the distances stay exactly as they were and a `KinshipPath` rides alongside, carrying the genders
the line actually ran through and — where the dates prove it — which of two siblings was born first.
Nothing about English changed, which is why every existing answer and the web viewer still agree.

`graph/HindiKinship.kt` reads that path and returns an *enum*, not a string, so the risky part —
which of five words English calls "uncle" — is plain Kotlin under JVM test. The spelling lives in
`res/values/kinship_hi.xml`, a flat list a Hindi speaker can review in one sitting.

Two properties are worth the tests they get. First, **a word is claimed only when the record earns
it**: ताऊ is an elder brother and चाचा a younger one, so with no birth years the app says
पिता के भाई and offers to sharpen it. Second, **every relationship must agree with its opposite
number** — if B is A's मामा then A must be B's भांजा or भांजी, computed independently from the other
end of the graph. Over every ordered pair of a whole family that is not a property you can satisfy by
accident, and cousins are the sharpest case: a फुफेरा भाई must see you as his ममेरा भाई.

Hindi falls back to English where it genuinely has no word — second cousins, great-uncles — because
that is what Hindi speakers do, and because a Devanagari compound nobody says would be worse than
the English word.

### Relating two people

Two questions with different failure modes, so they are answered separately (`graph/Kinship.kt`,
pure and JVM-tested):

- **The word for it** comes from the nearest shared ancestor — generations *up* to them and back
  *down* to the other person — and those two numbers produce every term English actually has.
  Nearest, then most symmetric: measured through a grandparent instead, two siblings would come out
  as first cousins. There is no word for most relationships, so this half is often absent.
  An explicit `SIBLING` edge is recorded precisely when the parents are *not* known, so each such
  group is given one unnamed stand-in ancestor to measure through — otherwise an aunt reachable only
  through her brother comes back as merely "related", the gap in the record swallowing a word the
  family uses every day. The stand-in is never shown; it has no name to show.
  A marriage at one *end* of the line is named too, because English names those: an uncle's wife is
  an aunt, a wife's mother a mother-in-law. Where it has no single word the pieces still say who
  somebody married — "married to Ankit's first cousin once removed" — which beats the flat
  "related by marriage" that every relative anybody married into the family used to get. A marriage
  in the *middle* is not nameable and is not named; "my aunt's husband's brother" is what he is, and
  the chain says it better than an invented word could.
- **The line between them** is a breadth-first search over *every* edge kind. Marriage is walked as
  well as blood, because "my wife's mother" is exactly what gets asked and no blood-only search can
  answer it. Blood steps are enqueued before marriage ones, so where two routes are the same length
  the one through the family wins — reaching a cousin via their husband is a true answer and a
  useless one.

The chain is always shown and the sentence only when there is one to give: a line amounting to
"these two are related somehow" tells a reader nothing the chain does not tell them exactly. On a
real 148-person tree that names 55% of all 21,756 ordered pairs, up from 31% when only blood
counted; the rest read their answer off the chain. `Kinship` returns the term as a *structure*, not a
string; the English lives in `ui/common/KinshipLabels.kt` with the rest of the app's words.

**Shown on the chart, the line is drawn on its own** rather than lit up inside the whole tree.
Fading the other hundred and forty people still leaves them on the page, and at the scale a whole
family needs, a faded hundred and forty is what the eye actually sees. So the chart lays out just
the people on the line — plus whoever holds it together, which is why `peopleToDraw` adds the parent
two siblings are derived through: a sibling step carries no edge of its own, and without him the
answer arrives as two loose cards. He is on the chart without being in the sentence. *Clear* puts
the rest of the family back.

## The `.ftree` format

A ZIP. Version 1:

```
tree.json
photos/<photoId>.jpg
```

```json
{
  "format": "f-tree",
  "version": 1,
  "exportedAt": "2026-08-31T00:00:00Z",
  "sourceTreeId": "<uuid, stable for the life of an installation>",
  "people": [
    {
      "id": "…", "name": "Ankit Kumar", "gender": "MALE",
      "birthDate": "1990-05-01", "deathDate": null, "deceased": false,
      "photo": "photos/….jpg", "notes": "…",
      "origins": [{ "treeId": "…", "personId": "…" }]
    }
  ],
  "relationships": [
    { "id": "…", "from": "<parent>", "to": "<child>", "type": "PARENT", "subtype": null }
  ]
}
```

ZIP rather than one large JSON: base64-encoding a few hundred photographs would inflate them by a
third and force the whole tree through memory to read one person's name.

**Compatibility.** Every field but `format` and `version` is optional, and unknown keys are ignored
on read, so a file written by a future release still opens. Those two are always written even though
they equal their defaults, because they are how a reader knows what it is holding. A file claiming a
*higher* version is refused rather than partly understood.

`sourceTreeId` identifies the installation that wrote the file. With a person's id it forms a stable
identity across exports; each person also carries the `origins` they were imported with, so a tree
that has already been merged once still matches exactly on a later import.

## Sharing one branch

Export writes the whole archive, because it is the user's archive and they are keeping it. Sharing
is a different act with a different shape: it is a message, it goes to somebody who may not have the
app, and it should carry a part of the family rather than all of it.

**What travels is a household and the households under it** — the person, everyone descended from
them, and the partners of all of them. Sandeep's share is Sandeep, his wife, his children and their
partners, and so on down. What stays behind is everything *above* and *beside* him: his parents, his
siblings, their children. Sending somebody a branch should not quietly hand over the rest of the
sharer's family, and a recipient starting their own tree from a relative's file wants the people
below that relative, not the archive they came from.

Partners come along at every level, because a couple is how a family is read and a child arriving
without the parent they married is a hole in the story. Their *parents* do not: they are the doorway
back into another whole family, which is exactly what this is not.

A relationship travels only when **both** ends do. A shared branch therefore never carries an edge
pointing at somebody who is not in the file — the reader could not resolve it, and it would leak the
existence of a person deliberately left behind.

The rule is [`FamilyGraph.branchFrom`](app/src/main/java/com/vibethroughcode/ftree/graph/FamilyGraph.kt),
which is an ordinary function over adjacency lookups and is tested as one.

### The file, and the message with it

The whole-tree export asks where to put the file. A share does not: nobody wants to name a message.
It is written to the cache as `Sandeep-Kumar-family.ftree`, handed over as a content URI for the
length of one intent, and the previous one is deleted on the next share rather than leaving copies of
a family in a temporary directory. It has its own `FileProvider` — a subclass, because two
`<provider>` entries naming the same class are one component to Android, and the first version of
this shipped URIs that arrived at the updater's provider and were refused.

The message that goes with it has to work for somebody looking at an attachment in a chat who has
never heard of this app: whose family it is, how many people, where to get the app, and that
importing will not overwrite anything they already have. Whether a given chat app *shows* that
message beside the document is that app's decision — which is why the file is named after whose
family it is. The name is the part that always arrives.

### Sharing a relationship as a picture

Sending a `.ftree` taught us something: **a chat app handed a document quietly drops the message
that came with it.** The file arrives, the sentence explaining it does not. Handed an `image/png`,
the same app shows the text beside the picture — Android's own share sheet does it too, which is how
this was confirmed rather than assumed.

So a relationship can also be sent as a card. Not a screenshot: a screenshot carries a status bar, a
navigation bar and whatever font size the sender happens to use, none of which is the answer. The
card is the app's own sentence and its own notation, laid out for the purpose, in two drawings of
the same line — **Tree**, cards down a spine with each step named on the rule that makes it, and
**List**, a register with a rail through the faces. The reader sees it before sending and picks.

The preview *is* the card. The same composable is drawn on screen and recorded into the file through
a `GraphicsLayer`, so there is no second rendering that could disagree with what was shown. Its
density is pinned at three pixels to the point rather than read from the device, which is what makes
the picture 1080 x 1350 from every phone; the preview scales that to fit after layout, so nothing is
re-measured. The ground is painted opaque, because a PNG with transparent corners is at the mercy of
whatever it lands on.

A line of any length fits, because both ends are always shown and a middle that will not fit is
counted rather than cut — "+4 more" is true where a silently shortened chain is not.

### Joining a shared branch to your own tree

This is the other half of why it exists. Import the branch, then create one relationship between
somebody in it and somebody in yours, and the two families are one graph: your wife's father is your
father-in-law, her brother your brother-in-law, and the relation finder can walk between them. There
is no special "merge two trees" mode, because there does not need to be — a tree is a graph and a
marriage is an edge.

Re-importing the same file is a no-op. Every record carries where it came from, so the second import
recognises those people outright rather than proposing them as duplicates.

## Merge behaviour

**An import adds; it never replaces.** Nothing already in the tree is deleted, and no existing value
is overwritten. The worst an import can do is add people who turn out to be duplicates — which can
then be merged. The opposite mistake, silently collapsing two real people into one, cannot be undone.
Every default follows from that asymmetry.

Reading and judging a file **writes nothing**; only a plan the user has confirmed is applied, in one
transaction.

| Evidence | Default |
|---|---|
| Provable — the file's origins name someone already held | merge, without asking |
| Same name **and a relative already matched** | proposed **merge** |
| Same name alone | proposed **keep separate** |
| Dates that cannot both be true, or an unnamed person | no match at all |

Matching runs in passes, so confirmed matches become evidence for their relatives: two people with
the same name are far likelier to be the same once their father has already matched. Names are
compared past accents, punctuation and spacing, but never abbreviations — guessing that "R. Kumar"
is "Raj Kumar" is how a merge quietly destroys data.

Applying:

- Imported ids are **always remapped** to fresh local ones; an id in someone else's file may belong
  to a different person here.
- Merging **fills gaps only**. An empty field takes the imported value; a field that already says
  something keeps saying it, and the disagreement is reported.
- Existing relationships are skipped, not duplicated.
- A **backup is written first**, to `files/backups/`, and the three most recent are kept.

Re-importing the same file, or the app's own export, is a no-op.

## Design decisions worth knowing

| Decision | Why |
|---|---|
| Edges, not a GEDCOM-style family/union table | Maps directly onto "add a parent", and makes merge far simpler |
| Siblings derived, not stored | Stays correct as parents are added; avoids O(n²) edges |
| Partial dates, no "approximate" flag | The precision *is* the statement about what is known |
| Enum names persisted, not ordinals | Readable in the database and in exports; stable across releases (R8 is told not to rename them) |
| No dynamic colour | Brass means "not known" throughout, including in the chart's notation; a wallpaper-derived palette would reassign that meaning |
| One `Canvas` for the chart | At a few hundred people, a composable per node costs far more than the drawing |
| Backup file instead of transactional undo | A file the user can re-import is a far simpler promise, and it cannot itself go wrong |
| The path kept beside the distances, not instead of them | English answers, their tests, and the web viewer are all untouched by adding a second language |
| Hindi rules return an enum, not a string | Puts the part that can be wrong under JVM test, and leaves the words in a list somebody can review |
| Descriptive term rather than a guess at चाचा/ताऊ | Guessing is wrong half the time in a way a family notices at once |
| A mandatory circular crop, stored square | The face is shown in a circle everywhere; framing it as a rectangle and hoping would mean choosing one thing and seeing another |
| Photographs off changes drawing, never layout | A setting that rearranged a hundred and fifty people would cost more than the memory it saves |
| A rail on a short window, not a bottom bar | A bottom bar takes eighty of a landscape phone's three hundred and sixty dp from the axis a tree is read along |
| Compact derived from the chart's own layout, not a second walk of the graph | Two views of one family cannot disagree about who is in it, and switching costs nothing |
| A tap in Compact walks rather than opens | Walking is the thing a family tree is *for*; opening a page is a step you take once you have arrived |
| No history behind the walk | The graph is symmetric, so every walk is already undone by one tap in the band it came from |
| Compact still shows photographs when the chart's are off | That switch buys back the cost of decoding faces while panning a canvas, which is a cost this view does not have |

## Turned sideways

A phone on its side has about three hundred and sixty density-independent pixels of height, and the
app was spending a third of them on its own furniture: a title bar, a mode switch, a line of counts
and a navigation bar, all stacked along the axis a family tree is read down.

On a short window — which is a question about the window, not the orientation, so a tablet on its
side keeps the bottom bar and a phone in a split screen does not — the three destinations move to a
`NavigationRail` on the leading edge, and the chart's title bar, mode switch and actions fold into
one row. That is roughly a hundred and forty dp given back to the drawing, which on a real family is
the difference between two generations on screen and four.

Reading matter goes the other way. A list of names stretched across a landscape phone puts the name
at one edge and the date at the other with a hand's width of nothing between them, so the lists,
forms and the settings are held to a readable measure and centred (`ui/common/Windowing.kt`). The
charts are exempt: they are pictures, not prose, and they want every pixel.

The compact view answers the same question a third way, because it is neither. Its cards turn on
their side — a face above a name is the better shape when height is what there is plenty of, and in
landscape that same card is a third of the screen — and the centre lays its marriages beside the
name instead of under it. Together that is four generations in view where there would have been two,
in the view whose whole purpose is fitting a family on a screen.

## Accessibility

The person list, person pages and every form honour the system text size in full and carry content
descriptions. The chart grows its cards with the text size so nothing is clipped.

Text painted onto a canvas is invisible to a screen reader, and giving every node its own semantics
would mean composing a node per person on every pan. So the charts describe themselves and point
elsewhere — and **Compact** is what they now point at: the same family, composed rather than
painted, where every person is one stop that announces "Vinod Kumar, 1962" and one action that
re-centres the view on them. Generations are headings, counts are text, and the whole thing grows
with the system text size instead of being scaled down to fit a fixed card.

A person's page remains the fullest account of any one individual, spelling out every relationship
in words; Compact is the route *between* people that the charts could not offer.

## Updating in place

`update/` is the only code in the app that opens a socket, and it is deliberately kept in one
package so that claim is checkable by reading rather than by trust. It is off until switched on in
Settings: `UpdateRepository` refuses to make a request while the preference is false, so "no network
unless you ask for it" is a property of the code and not of the interface.

**Why it exists.** Sideloading a new APK over the old one keeps the app's data directory — that is
ordinary Android behaviour, and it is the whole point. Without an updater, moving to a new version
means exporting, uninstalling, reinstalling and importing, four steps in which a family can be lost.

**What it checks before installing anything.** Three things, in this order:

1. the download's SHA-256 against the `digest` GitHub publishes for the asset,
2. that the archive's package name is this app,
3. that its signing certificate matches the copy already installed.

The third is the one that protects the tree. An APK signed with a different key *cannot* update this
one — Android refuses it — and the only way to install it would be to uninstall first, taking the
family with it. Checking here means that is refused by this app with an explanation, rather than
discovered at the end of a download.

The two permissions the app declares, `INTERNET` and `REQUEST_INSTALL_PACKAGES`, exist only for
this. The tree itself never goes near the network; there is no sync, no account, and no backend to
have one with.

## Releasing

Signing is driven by a gitignored `keystore.properties` at the repo root:

```properties
storeFile=/absolute/path/to/f-tree-release.jks
storePassword=…
keyAlias=ftree
keyPassword=…
```

```bash
./gradlew assembleRelease
```

**Or let CI do it.** Bump `versionName` in `app/build.gradle.kts`, tag it, push the tag:

```bash
git tag -a v0.2.0 -m "f-tree 0.2.0" && git push origin v0.2.0
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) checks the tag matches the app's
version, runs the tests, builds a signed APK from the keystore held in repository secrets
(`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_PASSWORD`; the key alias is not secret and lives in the workflow), verifies the signature, and
attaches it to the release. Write the release notes by hand first if you want them; the workflow
attaches to an existing release rather than replacing it.

Note that the secrets are a *deployment* mechanism, not a backup — a secret can never be read back
out. Keep the keystore file itself somewhere safe: losing it means no in-place updates, ever.

### Beta releases

A tag with a suffix — `v0.6.0-beta.1`, matching a `versionName` of `0.6.0-beta.1` — is published as
a GitHub **pre-release**. That single flag is the whole mechanism separating the two channels:
GitHub's `releases/latest` endpoint skips pre-releases, and the ordinary updater reads that endpoint,
so somebody who has not asked for betas cannot be handed one by accident.

The beta channel reads the full `releases` list instead, and takes the newest thing on it — which
means a beta reader is moved on to the stable release as soon as it supersedes the beta they are on,
without having to change any setting.

**Promoting a beta to stable** is a fresh tag without the suffix: bump `versionName` to `0.6.0`,
tag `v0.6.0`. Everybody gets it, including the beta readers, because `0.6.0 > 0.6.0-beta.1`.

Opting in lives at the very bottom of Settings, under the licence notice, behind copy that
discourages it and a dialog that has to be agreed to. It says the thing somebody would otherwise only
find out afterwards: Android will not install an older version over a newer one, so switching the
setting back does not move you off a beta — the next stable release does.

Release builds are minified. **Always install and exercise a release build before publishing it** —
R8 has broken this app once already, by renaming an enum that navigation resolves by name and that
the database persists by name. `app/proguard-rules.pro` explains what must be kept and why.

## The site

`site/` is the public landing page and install guide, deployed to GitHub Pages by
`.github/workflows/pages.yml` on any push to `main` that touches it. There is no build step —
edit the HTML and push.

It reads version, size, release date, SHA-256 and the download count from the GitHub Releases API
at run time, so cutting a release updates the site with no edit here, and the download count is
real asset downloads rather than a third-party tracker. There is no analytics script on either
page. Asset paths are relative, so the site works both at `thisisankit27.github.io/f-tree/` and at
a custom domain.

### The viewer

`site/playground/` is a browser-only reader for an exported `.ftree`. Where the app draws the
family *around one person* a few relationships deep — the right answer on a phone — the viewer
draws the whole archive at once, on a tablet or a television, **including the people no
relationship reaches**, who the app has nowhere to put at all.

It is plain ES modules, no build, no dependencies:

| | |
|---|---|
| `archive.js` | reads the ZIP and validates the document |
| `model.js` | derives siblings, family units, components, kinship terms |
| `layout.js` | generations, crossing reduction, coordinates, packing |
| `chart.js` | the canvas renderer |
| `main.js` | the interface |

Three decisions in there are load-bearing:

**The ZIP is read through its central directory, never the local file headers.** The app writes
the archive with `java.util.zip.ZipOutputStream`, which for DEFLATED entries emits a local header
with the CRC and both sizes zeroed and puts the real values in a trailing data descriptor. A reader
that trusts the local header sees a length of zero for every entry.
`tools/make_sample_tree.py` therefore emits one fixture through an unseekable stream so CI keeps
testing that path.

**Semantic zoom is what makes a large archive readable.** Drawing every name at every scale gives a
grey wash the moment a whole family is on screen, so the chart draws less as it pulls back: at a
distance the cards are plain shapes and what you read is the shape of the family — how many
generations, how wide each got, and where the record has holes, because an unknown person keeps
their brass dashed edge at every scale.

**A generation is a relative fact, not a depth.** A child sits exactly one row below each parent,
and spouses — and siblings whose parents nobody recorded — sit on the same row; those offsets are
propagated out from one seed per connected family, which fixes every row exactly, because the offset
between two people is the same along every route between them.

The textbook alternative, ranking people by their longest path down from the oldest ancestor on
record, is wrong in a way that takes a real family to notice: it makes a person's row depend on how
far back *their* ancestry happens to be written down. A maternal grandfather whose own parents are
unknown lands on the top row beside a great-great-grandfather from the other side of the family, and
his children scatter across rows, each dragged down by however deep their own spouse's ancestry ran.

Everything happens in the tab. The file is never uploaded, there is no analytics on the page, and
the only thing stored is four display preferences in `localStorage`.

```bash
python3 tools/make_sample_tree.py /tmp/fixtures   # .ftree files, including odd ones
node tools/check_layout.mjs /tmp/fixtures         # layout invariants, run in CI
```

To preview it locally:

```bash
python3 -m http.server 8731 --directory site
```

### Custom domain

The domain is claimed by a `site/CNAME` file. Add it only once DNS resolves — claiming it earlier
redirects the working `github.io` URL to a hostname that does not answer yet. For a subdomain,
add a `CNAME` record pointing `ftree` at `thisisankit27.github.io`, wait for it to resolve, then:

```bash
printf 'ftree.vibethroughcode.com' > site/CNAME
git add site/CNAME && git commit -m "chore(site): claim the custom domain" && git push
```

## Toolchain

| | |
|---|---|
| Gradle | 9.7.1 |
| Android Gradle Plugin | 9.3.2 |
| Kotlin | 2.3.21 |
| compileSdk / targetSdk / minSdk | 37 / 36 / 26 |

AGP 9 ships built-in Kotlin support, so `org.jetbrains.kotlin.android` is declared in the root build
file with `apply false` — purely to pin the Kotlin version on the build classpath — and is never
applied by a module.

Dependencies are deliberately few: Compose, Room, kotlinx-serialization, Coil, Navigation. No DI
framework, no networking, no analytics.

## Not built (and why)

- **Transactional undo of an import.** The backup file covers the same need far more simply.
- **GEDCOM import/export.** A large format for a lightweight app; the documented `.ftree` schema
  covers sharing between users of this app.
- **A whole-graph chart.** Unreadable at any real family size; re-focusing is the answer.
- **A Hindi interface.** Only the family *words* change with the setting; buttons, settings and error
  messages stay English. Translating those is a separate job needing a fluent reviewer, and a
  half-translated app reads worse than an English one.
- **Languages beyond Hindi.** The path model covers Bengali, Marathi, Gujarati, Punjabi, Tamil and
  Telugu structurally, and each is then a word list plus a small rules file — but kinship terms
  should not ship in a language without a native speaker checking them.

## Licence

[MIT](LICENSE) — use it, change it, ship it; just keep the copyright notice.

The bundled fonts (Literata, JetBrains Mono) are separately licensed under the SIL Open Font Licence
1.1. Their licence texts ship inside the app and are surfaced on its About screen.
