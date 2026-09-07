# Contributing to f-tree

Thank you for looking. f-tree is a small app with a deliberately small dependency list, and it is
possible to hold the whole thing in your head in an afternoon — which is the point.

There are two ways to help that need no Android experience at all, so they come first.

---

## You do not need to write Kotlin to help

### 🌏 Kinship terms in another language

This is the single most valuable contribution the project can receive, and it needs a **native
speaker** far more than it needs a developer.

English kinship is two numbers: how many generations up to a shared ancestor, and how many back
down. That throws away the side of the family and the birth order — which is fine for "uncle" and
useless for most of the world. f-tree already carries a `KinshipPath` alongside those numbers,
recording the genders the line ran through and, where the dates prove it, which of two siblings was
born first.

Bengali, Marathi, Gujarati, Punjabi, Tamil and Telugu are **structurally covered by that model
already**. Each is a word list plus a small rules file, following the shape of
[`graph/HindiKinship.kt`](app/src/main/java/com/vibethroughcode/ftree/graph/HindiKinship.kt) and
[`res/values/kinship_hi.xml`](app/src/main/res/values/kinship_hi.xml).

If you speak one of these and are willing to review a word list, **[open an
issue](https://github.com/thisisankit27/f-tree/issues/new/choose)** and say so. Terms will not ship
in a language without a native speaker checking them — a wrong kinship word is the kind of mistake
a family notices immediately.

Read [docs/kinship-hindi.md](docs/kinship-hindi.md) to see the shape of it.

### 🐛 Real families that break things

The chart layout is tested against deliberately awkward invented families. Actual ones are better.
If your family produces a chart that looks wrong, an import that behaves oddly, or a relationship
named incorrectly — that is a valuable bug report.

**Please do not attach a real family's data.** Describe the shape instead ("two half-siblings whose
shared parent is unknown"), or reproduce it with the seeder below.

### ♿ Accessibility testing

TalkBack, large system text sizes, and landscape on a small phone. The *Compact* view exists
specifically so a family tree can be read aloud; reports about where it fails are welcome.

### 📝 Documentation

Anything on this repo's pages. Corrections, clarifications, or translation.

---

## Getting set up

```bash
git clone https://github.com/thisisankit27/f-tree.git
cd f-tree
./gradlew assembleDebug
```

You need **JDK 17+** and the Android SDK (platform 37, build-tools 36). Android Studio will offer
to fetch both. The project always builds without a signing keystore.

Install and run it:

```bash
./gradlew installDebug
adb shell am start -n com.vibethroughcode.ftree/.MainActivity
```

**Do not tap through hundreds of forms to get test data.** Debug builds carry a seeder:

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

Full detail in [docs/building.md](docs/building.md).

---

## How the code is laid out

```
data/       Room entities, DAOs, the repository, photo storage
graph/      pure graph logic: traversal, relationship rules, chart layout
transfer/   the .ftree format, export, import, duplicate matching
update/     the optional updater — the only code that touches the network
ui/         Compose screens, one package per area
```

Two rules shape it, and a change that respects them will review quickly:

1. **Anything worth reasoning about is pure.** Chart layout, relationship rules and the duplicate
   matcher take plain data and return plain data — no Room, no Compose. They run off the main
   thread and are tested directly on the JVM. If you are adding logic that could be wrong, put it
   in `graph/` or `transfer/` where a JVM test can reach it.
2. **No DI framework.** [`AppContainer`](app/src/main/java/com/vibethroughcode/ftree/AppContainer.kt)
   wires one repository by hand. Please do not add one.

[docs/architecture.md](docs/architecture.md) explains the reasoning behind each part in full, and
the [design decisions table](docs/architecture.md#design-decisions-worth-knowing) records why the
obvious alternative was not chosen. It is worth a skim before proposing a structural change —
several of the surprising choices are load-bearing.

---

## Before you open a pull request

```bash
./gradlew testDebugUnitTest          # pure logic: dates, graph rules, layout, matching
./gradlew connectedDebugAndroidTest  # database, transfer, Compose UI flows (needs a device)
./gradlew lintDebug
```

CI runs the unit tests and lint on every pull request. The instrumented tests need a device, so
run those locally if you touched `data/`, `transfer/` or a screen.

A good pull request:

- **Does one thing.** A layout fix and a new setting are two pull requests.
- **Adds a test for logic that could be wrong.** Especially in `graph/` and `transfer/`, where it
  costs nothing — no emulator, no device.
- **Says what it is for**, in the terms a user would use. "Half-siblings drawn under the wrong
  connector" beats "fix TreeLayoutEngine offset".
- **Keeps the notation consistent.** Brass means *not known*, a doubled rule means marriage, a
  dashed edge means an unrecorded name. These mean the same thing in every view, including the web
  viewer, and that consistency is deliberate.
- **Matches the surrounding style.** Match the comment density and naming of the file you are in
  rather than a general standard.

Branch names follow `feat/…`, `fix/…`, `chore/…`, `docs/…`. Commit messages are conventional
(`fix(chart): …`) but this is not enforced by a hook.

### Changes that need a conversation first

Open an issue before starting on:

- a new dependency (the list is deliberately short: Compose, Room, kotlinx-serialization, Coil,
  Navigation),
- anything that changes the `.ftree` format or the database schema,
- a new screen or navigation destination,
- anything touching `update/` — it is the only networked code and its checks are security-relevant.

This is to save your time, not to gate-keep. A rejected PR you spent a weekend on is a worse
outcome for everybody than a five-minute issue thread.

---

## Reporting a bug

Use the [issue templates](https://github.com/thisisankit27/f-tree/issues/new/choose). The two
things that matter most: **what you expected to happen**, and **the shape of the family** it
happened with.

For anything security-relevant, do not open an issue — see [SECURITY.md](SECURITY.md).

---

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

Contributions are accepted under the [MIT Licence](LICENSE), the same terms as the project.
