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
- **Two charts.** *Around one person* draws their ancestors above and descendants below, with pan,
  zoom and tap-to-recentre. *Everyone* draws the entire tree at once — every generation, every
  household, and the people no relationship reaches, whom the focused chart has nowhere to put.
- **A relation finder.** Pick any two people and f-tree names the relationship — "first cousin once
  removed", "great-great-grandfather" — and lists every person the line runs through, which is the
  form that can also answer the ones English has no word for. It walks marriages as well as blood,
  and will draw the line across the whole-tree chart.
- **Optional in-app updates.** Off until switched on. Checks GitHub for a newer release and installs
  it over the running copy, so a new version keeps your tree instead of costing an export and an
  import.
- **Export and import as a single `.ftree` file**, with merge semantics that never overwrite.
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

### Relating two people

Two questions with different failure modes, so they are answered separately (`graph/Kinship.kt`,
pure and JVM-tested):

- **The word for it** comes from the nearest shared ancestor — generations *up* to them and back
  *down* to the other person — and those two numbers produce every term English actually has.
  Nearest, then most symmetric: measured through a grandparent instead, two siblings would come out
  as first cousins. There is no word for most relationships, so this half is often absent.
- **The line between them** is a breadth-first search over *every* edge kind. Marriage is walked as
  well as blood, because "my wife's mother" is exactly what gets asked and no blood-only search can
  answer it. Blood steps are enqueued before marriage ones, so where two routes are the same length
  the one through the family wins — reaching a cousin via their husband is a true answer and a
  useless one.

The chain is always shown and the word only when there is one, because the chain is the half a
reader can check against their own memory. `Kinship` returns the term as a *structure*, not a
string; the English lives in `ui/common/KinshipLabels.kt` with the rest of the app's words.

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

## Accessibility

The person list, person pages and every form honour the system text size in full and carry content
descriptions. The chart grows its cards with the text size so nothing is clipped.

**A stated limitation:** text painted onto a canvas is invisible to a screen reader, and giving every
node its own semantics would mean composing a node per person on every pan. The chart therefore
describes itself and points at the people list, where each person's page spells out every
relationship as ordinary text. That is a complete alternative route, but it is a limitation.

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

**Generation ranking is compacted after it is assigned.** Longest-path ranking alone strands a
person whose only child married into a deeper part of the family several rows above them, trailing
a connector the height of the chart.

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
- **Photos on chart nodes.** Needs pre-decoded bitmaps in the canvas; the chart's value does not
  depend on it.
- **A whole-graph chart.** Unreadable at any real family size; re-focusing is the answer.

## Licence

[MIT](LICENSE) — use it, change it, ship it; just keep the copyright notice.

The bundled fonts (Literata, JetBrains Mono) are separately licensed under the SIL Open Font Licence
1.1. Their licence texts ship inside the app and are surfaced on its About screen.
