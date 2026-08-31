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
- **A focused genealogy chart.** One person's ancestors above and descendants below, with pan, zoom,
  and tap-to-recentre.
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

Release builds are minified. **Always install and exercise a release build before publishing it** —
R8 has broken this app once already, by renaming an enum that navigation resolves by name and that
the database persists by name. `app/proguard-rules.pro` explains what must be kept and why.

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
