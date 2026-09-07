# Building, testing and releasing

Everything you need to get f-tree running from source, and how a release is cut.

New contributors: read [CONTRIBUTING.md](../CONTRIBUTING.md) first — it has the short version and
a list of good first issues.

**Contents**

- [Build](#build)
- [Run](#run)
- [Test](#test)
- [Toolchain](#toolchain)
- [Releasing](#releasing)
- [Beta releases](#beta-releases)

---

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

[`.github/workflows/release.yml`](../.github/workflows/release.yml) checks the tag matches the app's
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


---

## Where to go next

- [Architecture](architecture.md)
- [The website and the browser viewer](site.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
