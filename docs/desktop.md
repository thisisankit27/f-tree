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

## Settings

`Updates > Preferences…`, on `Ctrl+,`. Family words, photographs on the chart, appearance, and the
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

`View > How are two people related?`, on `Ctrl+R`, or the `R` key. Pick two people; the answer is a
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

There is no button for it on the toolbar, deliberately. The website has one because a browser tab has
nowhere else to put it; this bar already carries what the website's does *and* the editing tools, and
it is full — measured on a 1095px window, adding one 26px icon took the header from 56px to 93px
because the row wraps. The menu is the affordance a tab does not have, so that is where it lives.

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

Two switches under **Updates**, both off until the reader turns them on, and the same two the
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

## Not yet

The desktop app currently **reads** a tree. Editing, the settings screen, Hindi kinship and photos
are tracked in [#89](https://github.com/thisisankit27/f-tree/issues/89).
