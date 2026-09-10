# The desktop app

f-tree on Windows and Ubuntu. It reads a `.ftree`, and it writes one: a tree can be built here from
nothing by somebody who has never owned the phone app. Generations run as **rows**, ancestors at the
top, as the website viewer draws them — columns are the layout for a screen taller than it is wide,
and a laptop never is.

`desktop/` is an Electron shell around `site/playground/`. **One viewer, two shells**: the chart,
the index, the search, the kinship engine and the themes are the same files the website serves, so
a fix to the chart is a fix in both places rather than a fix and a note to remember the other one.
What the shell adds is what a browser tab cannot have — a real file picker, a native menu, and a
memory of which tree you were reading.

## Three ways to read a tree

| | | |
|---|---|---|
| **Chart** | `Ctrl+1` | The whole tree, drawn. Pan, zoom, search, click a person to edit them. |
| **People** | `Ctrl+2` | Everybody by name, grouped as the chart groups them, filterable to the living. The only place somebody with no recorded relatives is as visible as anybody else. |
| **Compact** | `Ctrl+3` | One person's family as generation bands, read as text at any size. |

Compact exists for the space between the other two. The chart is a picture: to read a name you
zoom, to reach a relative you pan, and a canvas holds nothing at all for a screen reader. The people
list is alphabetical and has no family in it. Compact is the missing middle — centred on somebody,
three generations up and down, with everybody's partners; deliberately **not** cousins or nieces,
which multiply a chart's width far faster than they add to what it tells you. Clicking a name walks
the reading to that person. Where the record goes further than the reading, it says so and offers
to go on.

## Saving: once, then automatic

A tree with a file is **written back to it about a second after each change**
([#149](https://github.com/thisisankit27/f-tree/issues/149)). The bar beside the file name says
where things stand:

| | |
|---|---|
| **Saved** | every change is on disk |
| **Saving…** | a change is in its pause, or being written |
| **Not saved yet** · *Save…* | a new tree that has never had a file. Save it once and it autosaves from then on |
| **Not saved** · *Retry* | a write failed. The reason is in a toast, once, and f-tree keeps retrying with backoff |

Changes are batched rather than written one by one (`renderer/autosave.js`). A write reads the
whole tree back to verify it (`renderer/save.js`), and a burst of edits needs one write, not ten. A
change that lands during a write is picked up straight after it. `Tree.markSaved` takes the
signature of what was *written*, so an edit made mid-write is never marked saved by mistake.

`Ctrl+S` still works, and just skips the pause. Closing the window first asks the page to write
anything still in its pause, and closes without a question if that was all. The quit prompt is left
for work that really isn't on disk: a new tree with no file yet, a person half-edited in the panel,
or a failed write. Opening or starting another tree asks the same question in those cases. Before
0.6 it quietly threw away a new tree that had never been saved.

The phone does not autosave either: its tree lives in a database, so there is never an unsaved tree
there. Writing back to the open file is the desktop's closest equivalent.

### Backups

Autosave makes a mistake permanent almost immediately, so earlier versions are kept
(`desktop/backups.js`), following Android's rule for pre-import backups: *keep a few, not a growing
pile*.

- One copy of the file as it was **before the first write of each run**, so opening a tree and
  spoiling it always leaves the version you opened.
- Then **at most one every ten minutes** while writes continue.
- The **newest five** per tree.

They live in the app's own data folder, one folder per tree. The folder is named after the file,
plus a hash of its path, so two `family.ftree`s never share one. Nothing is added beside your own
file. The old sibling `<name>.bak` is gone, because under autosave it would have been overwritten
every second. **File › Show backups** opens the folder. A backup is an ordinary `.ftree`: open it,
and use Save as to keep it.

## Editing a person

The person panel keeps its edits as a draft and writes them to the tree on **Save**, which is how
the phone's edit screen has always worked ([#148](https://github.com/thisisankit27/f-tree/issues/148)).
It used to commit each field as it lost focus. That meant nothing on screen said an edit had been
taken, and closing the panel with a field still focused depended on the browser firing `change`.

| | |
|---|---|
| **Save** | keeps the draft as one step in the history (the panel then says *Updated*); disabled while there is nothing unsaved |
| **Add** | the same button for somebody "Add a person" has just created, still blank |
| **Discard** | backs out of that addition. The blank card goes, with no trace in the history (`Tree.withdraw`) |
| **Delete this person** | for anybody already in the tree. Asks first when they have connections |
| leaving with edits | *Discard changes? / Your edits to this person won't be kept.*, in Android's words |

"Discard" is offered only while the person is a fresh, blank addition. On anybody else the button
removes them and every one of their connections, and "Discard" would read as "discard my edits",
which is not what happens.

**Deleting somebody with connections** offers Android's two choices: *Keep as unknown*, which clears
their details but keeps their place so the family still joins up (`Tree.clearDetails`), and *Delete
completely*. Somebody joined to nobody is deleted straight away. Either way the toast carries an
**Undo** button.

**Dates are checked before they are kept**, by Android's rules (`renderer/person-draft.js`): a date
must be `1938`, `1938-04` or `1938-04-17`, and a death may not end before the birth begins.
Overlapping partial dates are fine, since "born 1938, died 1938" is real. A space, slash or full stop
typed in a date becomes the dash as it is typed
([#90](https://github.com/thisisankit27/f-tree/issues/90)), so the parser stays exactly as strict as
it was. A death date ticks *No longer living*, and unticking it clears the date.

Ctrl+Z inside a text field undoes the typing, not the last change to the tree. The menu owns the
accelerator, so without that exception it would take back a relative added a minute ago.

## Photographs

A face in the person panel, and **click it to see the photograph whole** — every other surface shows
it inside a circle, and a square cut from a group photograph is often the wrong square, so this is
where somebody checks what the file actually holds.

Add, replace or remove from the same panel. The picker returns **bytes, not a path**: a path is a
promise about somebody else's filesystem that this app cannot keep, and a tree full of pictures that
silently stop loading is worse than one with none.

The renderer does the encoding, and the numbers are not this app's to choose:

| | |
|---|---|
| square about the drag, longest edge | **512px** — `PhotoStore.STORED_EDGE` |
| JPEG quality | **85** — `PhotoStore.QUALITY` |
| smaller than 512 | left alone, never scaled up |

A desktop-written file has to be indistinguishable from a phone-written one, because the same tree is
carried back and forth and a photograph that changes size and weight every crossing is a file that
grows without anybody adding anything.

**Framing is not cropping.** The square is always the largest that fits, and dragging only chooses
where along the long edge it sits — enough to move a face out of a corner, and well short of
rebuilding an image editor. Arrow keys do it too. The circle drawn over the square is the shape every
surface will show it in; it is not stored that way, because a round image would need a PNG with an
alpha channel, several times the size, to save a shape that everything showing it already draws.

Stored as `photos/<uuid>.jpg` under a name nothing else in the tree is using — import brings
photographs in under names chosen by another machine, and two people sharing an entry means replacing
one person's face replaces the other's. `photosStillUsed()` prunes on save, so a removed photograph
stops riding along in every future write.

Honours **Photographs on the chart**: when it is off the chart is passed *no archive at all*, rather
than the real one and an instruction to ignore it.

## Family words: English or हिन्दी

Set in Preferences. When it is हिन्दी, an answer in the relation panel gains a second line under the
English one — `word (gloss)` — and **the English wording does not change anywhere**.

Under rather than instead, because the two are not the same statement. English says "uncle"; Hindi
says *which* uncle. A reader who set this preference is usually the one being asked to explain the
word to somebody else, and `दादी (father's mother)` is how a bilingual family actually says it.

Hindi has five words where English has one, and none of them can be reached by translating the
English. The choice reads `relate(...).kinship`: which parent the line went up through, who it came
back down through, and — for चाचा against ताऊ — which of the two was born first. That is why the path
model exists at all.

| | |
|---|---|
| `site/playground/kinship-hindi.js` | which word, ported from `graph/HindiKinship.kt` |
| `site/playground/kinship-hi.js` | how each of the 65 terms is spelled and what it means |

**Null is a real answer.** Hindi has no single word for a second cousin, or a relative through two
marriages. Where it has none the panel says the English sentence it would have said anyway — which is
what a Hindi speaker does in the same conversation, and better than a Devanagari compound nobody says.

Where the record cannot settle a birth order, the word is the descriptive one — पिता के भाई, which is
exactly what he is — and the panel says which two birth years would sharpen it. It does not guess:
ताऊ and चाचा are told apart by nothing but a date, and being wrong is noticed immediately.

Three tests hold it: the 43-case table from `HindiKinshipTest.kt`; a parity test that reads
`app/src/main/res/values/kinship_hi.xml` and asserts the JS table matches it exactly in both
directions; and the every-pair sweep, which cannot be satisfied by luck — *if B is A's मामा then A
must be B's भांजा or भांजी*, computed independently from opposite ends of the graph.

## Settings

The gear on the bar, `Settings > Preferences…`, or `Ctrl+,`. Family words, photographs on the chart, appearance, and the
two update settings. Every one of them is also in the native menu, and **both surfaces go through
the same `settings:set`**, which rebuilds the menu from the result.

That rebuild is the point rather than a detail. A native menu checkbox's `checked:` is a snapshot
taken when the menu was built: one surface over one value is fine forever, and two is fine until
somebody uses the second one. Before this, switching betas on in a dialog would have left the menu
saying they were off until the app restarted.

The rules live in `desktop/settings.js` — pure, no disk and no Electron, ported from
`update/UpdatePreferences.kt` with its reasoning. Some settings are not independent of each other:

| | |
|---|---|
| turning update checking **off** | clears the last-checked time and any skipped version — *"leaving a remembered result behind would let a stale banner outlive the setting"* |
| changing **channel** | clears the skipped version — *"a version skipped on one channel means nothing on the other: leaving it behind would silently hide the first release the reader has just asked to be offered"* |

Both `lastCheckedAt` and `skippedVersion` are new here. The desktop stored neither, so its update
dialog's "Not now" remembered nothing and the same release was offered on every launch until it was
taken — which teaches people to dismiss the dialog unread, and then the one release that matters is
dismissed the same way. **Skip this version** is now a separate answer from **Not now**: one is about
today, the other about this release. Only the automatic check honours a skip; asking from the menu
always gets an answer, because a question deserves one.

The two settings that reach the network are off until switched on. This app makes no request of any
kind unless somebody has asked it to, and a default of "on" would quietly make that untrue for
everybody who never opened the menu. Betas and checking are separate settings rather than three
states of one, because they answer different questions — whether the app may ask GitHub anything,
and which answer it will accept — so betas with checking off makes no request at all, and the
checkbox is greyed rather than merely useless.

The theme lives in that file too, with everything else. `localStorage` keeps a mirror of it, and
only for the inline script that sets the theme before the first paint: the settings file is read
over IPC and there is no asking it anything that early. A cleared mirror costs one launch in the
system's colours, not a lost setting.

## How two people are related

The bar's relation button, `View > How are two people related?`, `Ctrl+R`, or the `R` key. Pick two people; the answer is a
sentence, a chain of people you can click through, and the chart cut down to just that line, with the
whole tree back when the question is closed. It is seeded from whoever is selected, because "how is
*this* person related to…" is the question somebody has in mind when they reach for it.

The engine is `relate` in `site/playground/model.js` — the same one the website uses, held to
`kinship-golden.txt`. It walks marriages and adoptions as well as blood, so it answers questions no
blood-only search can: "my wife's mother" is exactly what this feature gets asked.

Three sentences, and sometimes none:

| | |
|---|---|
| a blood relationship | *"Priya is Ankit's **first cousin**."* |
| a marriage at the far end | *"Madhu is married to Ankit's **first cousin once removed**."* — because "Ankit's first cousin once removed's wife" is a possessive chain nobody says out loud |
| a relative of somebody's spouse | *"Rekha is the **mother** of Ankit's wife."* |
| none of those | no sentence at all — the chain says it exactly, and a sentence amounting to "these two are related somehow" tells a reader nothing the chain does not |

It is reached four ways. The bar's **Find a relation** button (Android's `compare_arrows` mark and
its `relation_find` words) starts a fresh question. **How are we related?** starts from somebody
already on screen, which is the commoner form of the question
([#151](https://github.com/thisisankit27/f-tree/issues/151)): from the person panel, from any row of
the people list, and from the person the compact view is centred on. Starting from a person puts
them in the first slot even if an earlier question left somebody else there, and empties the second
for you to fill.

For a while the bar deliberately had no button for it. Measured on a 1095px window, one more icon
took the header from 56px to 93px because the row wrapped. #150 removed Undo, Redo and Save from the
bar. Saving is automatic, and undo lives in Ctrl+Z, the menu, and an Undo button in every toast that
announces something undoable. That freed the room, and the bar now also has **Preferences**.
Re-measured: one 56px row from 1440 down to 880px. Below 1240px the file name moves to the window's
title bar, and the bar keeps the save state.

The rules about who appears live in `site/playground/focus.js` and `site/playground/compact.js`,
ported from `graph/TreeLayoutEngine.kt` and `graph/CompactFamily.kt` with their test tables. On
Android, compact is derived from the focused chart, so the two cannot disagree; the desktop's chart
is the whole tree and there is no focused chart here, so compact makes that selection itself. That
is a deliberate difference, and the reason the selection rules sit in one shared module.

## Why Electron and not the app's own code

Compose Multiplatform would reuse the app's Kotlin, which is the better answer on paper. It is the
wrong one here: the app is `com.android.application` with Room, `Context`, `Intent` and Coil across
97 source files, and moving it into a multiplatform source set restructures the Gradle build of a
release that has live users on it.

The cost of the choice, stated plainly: this is a **second implementation of the app's behaviour**,
in a second language, kept in step by hand. Anything ported from Kotlin should come with the
Kotlin's own test cases so a divergence fails a test rather than surprising somebody's grandmother.

Installers are around 100MB. That is what Electron costs.

## Layout

| | |
|---|---|
| `desktop/main.js` | the shell: window, menu, file dialogs, the session file, the smoke test |
| `desktop/preload.js` | the only bridge between page and machine, and a deliberately short one |
| `desktop/build/icon.png` | the mark from the website, at 512px |
| `site/playground/*` | the viewer, carried into the package as a resource |

The page reaches the machine only through the names in `preload.js`. A tree is somebody's family,
and the reason the app never uploads it is the reason that list is short and explicit rather than
a general-purpose `fs`.

## It refuses the network

`refuseTheNetwork` cancels every `http`, `https` and websocket request in the session. Not a
promise in a policy — the request is refused, so the claim holds whatever the page's markup asks
for now or later, and the one request the viewer does make (Google Fonts, right for a web page and
wrong for this) is logged and dropped.

Literata and JetBrains Mono are therefore read from disk: the same two files the Android app ships,
carried in as a resource and injected as `@font-face`. Without them the app falls back to the
system serif and monospace, which is worth a line in the log and not worth refusing to open
somebody's family tree over.

## Which way the generations run

`layoutArchive(graph, { orientation })` takes `'rows'` (the website — a landscape reader for a
whole archive on a big screen) or `'columns'` (the desktop, and the Android app).

Only one engine exists. The ordering, the crossing reduction and the packing are about *which*
person sits where in a generation, a question with no direction in it, so the column layout is the
same engine run with the card turned on its side and the answer transposed at the end. The
connectors are measured last, in finished screen coordinates, from a single orientation-agnostic
routine — which is why the renderer draws plain segments and knows nothing about which way the
page runs.

`tools/check_layout.mjs` runs its invariants in **both** orientations.

## Running it

```sh
cd desktop
npm install
npm start
```

The smoke test starts the real app, opens a real `.ftree`, and asserts the bridge is reachable, the
tree arrived, and the generations run in columns:

```sh
FTREE_SMOKE=/path/to/tree.ftree npm run smoke
# FTREE_SMOKE_SHOT=/tmp/shot.png also writes a screenshot
```

A desktop app is the one thing in this repository that cannot be checked by reading it: the shell,
the preload bridge and the viewer only meet each other once a window exists.

## Building installers

```sh
npm run pack:linux   # AppImage + deb
npm run pack:win     # NSIS installer, on Windows
```

CI does both, on `ubuntu-latest` and `windows-latest`, for every change to `desktop/` or to the
viewer.

## Linux packaging, and the AppImage problem

Three Linux targets, in the order the download page offers them:

| | |
|---|---|
| `.deb` | the ordinary answer on Ubuntu, Debian and Mint |
| `.tar.gz` | a portable folder: unpack anywhere, run it, install nothing |
| `.AppImage` | for people who prefer them, with a caveat |

**An AppImage will not start on Ubuntu 24.04 or newer by double-clicking.** Those releases replaced
the FUSE 2 helper the AppImage runtime needs: `/usr/bin/fusermount` is now a symlink to
`fusermount3`, which speaks a different protocol, and the failure is
`fusermount: file descriptor 5 is not a socket, can't send fuse fd` in a terminal or nothing at all
from the desktop. **Installing `libfuse2` does not fix it** — the library is present and the helper
is what is missing — so the advice found all over the internet is wrong for these releases.
`--appimage-extract-and-run` works, and the `.deb` and `.tar.gz` need nothing.

That is why the updater only offers an AppImage to somebody already running one, where it is known
to work because they are running it. A `.deb` install is told a new version exists and sent to the
download page, because installing one needs root and the app has no business asking for it.

## Releases, and why they are pre-releases

A desktop release is tagged `desktop-v<version>` and published as a **pre-release**. Neither is
cosmetic.

The Android updater reads this repository's releases and parses each tag with
`^v?(\d+(?:\.\d+)*)(?:-(.+))?$`. `desktop-v0.1.0` cannot match, so a desktop release is invisible
to the ordinary channel and to the beta channel alike. The pre-release flag is the second,
independent guard: `releases/latest` — the endpoint the ordinary channel reads — skips
pre-releases, so it goes on answering with the newest *app* release.

Publishing a desktop build as an ordinary release would make `releases/latest` return something
with no APK on it, and every phone checking for updates would quietly stop being offered any. Two
guards, because there are live users on the app.

## The updater

Two switches under **Settings**, both off until the reader turns them on, and the same two the
Android app offers for the same reasons:

| | |
|---|---|
| Check for updates automatically | one quiet look at startup; silent unless there is something to say |
| Offer me beta releases | asks first, and states the consequence, as the app's dialog does |

`update.js` holds the decision and nothing else — which release, for which platform, on which
channel — as a pure function, so the awkward cases are settled by the table in `update.test.js`
rather than against the network. That is the mitigation promised in #89 for porting rules into a
second language: a divergence fails a test.

Two rules differ from the Kotlin on purpose, and both are commented where they live:

- Every desktop release is a GitHub *pre-release* by design, so `prerelease` cannot mean "beta"
  here. The **suffix on the tag** does: `desktop-v0.2.0` is stable, `desktop-v0.2.0-beta.1` is not.
- An empty candidate list means "up to date" rather than "nothing usable" when it was the channel
  filter that emptied it. A reader who has not asked for betas, on the newest stable build, is up
  to date; telling them the repository is broken would point at the wrong thing.

Downloads are verified against the SHA-256 GitHub publishes for the asset **before** anything is
offered to run; a mismatch deletes the file and installs nothing. On Windows the installer can be
launched from the app. On Linux the AppImage is downloaded and revealed — a `.deb` needs `apt` and
an AppImage is the reader's file to put where they want it, so the app does not pretend otherwise.

**This is the one thing that reaches the network,** and it is made from the main process. The window
stays refused outright, so nothing the page contains can ever call out.

## What it deliberately does not have

[#89](https://github.com/thisisankit27/f-tree/issues/89)'s parity checklist is done, so this section
is no longer a list of things being built. One item on it was closed by deciding *not* to do it, and
that is worth keeping written down — otherwise it reads as an oversight and somebody adds it.

**The focused chart.** Android draws a second chart centred on one person, their ancestors and
descendants only, everybody else hidden. A phone needs it: at that width the whole tree is unreadable
and the ego-centric view is the only way to see a line at all.

A laptop is the opposite shape. The whole tree fits across it, which is why both **JavaScript** shells
— this app and the website viewer — draw generations as rows, while the Android app keeps columns for
the screen it is on. **Compact** already answers the want the focused chart exists for, in a form the
canvas cannot manage: text at any size, three generations up and down, and reachable by a screen
reader. Two views of one person's line, one of them worse, is not parity.

`collectFocused` in `site/playground/focus.js` is the Kotlin's `TreeLayoutEngine.collect`, ported and
tested, because Compact is built on it. The engine can do this; the shell chooses not to offer it as
a chart.

**Columns, in these two shells.** The Android app draws them and always has — that is the right
layout for a phone, and #89 reversed the *desktop*, not the app. What the JavaScript engine keeps is
the ability to draw either, with CI checking both orientations, so the one neither JS shell currently
ships is the one that cannot rot unnoticed.
