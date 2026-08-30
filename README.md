# f-tree

A lightweight, local-first Android app for maintaining a personal family tree.

No accounts, no login, no backend, no cloud. One person maintains their own family graph on
their own device. Trees are shared by exporting a file and importing it — and **import merges
into your tree rather than replacing it**.

> Status: in active development. See the [issues](https://github.com/thisisankit27/f-tree/issues)
> for the current workstreams.

## Build

Requires JDK 17+ and the Android SDK (platform 37, build-tools 36).

```bash
./gradlew assembleDebug
```

## Run

```bash
./gradlew installDebug
adb shell am start -n com.vibethroughcode.ftree/.MainActivity
```

## Test

```bash
./gradlew testDebugUnitTest        # JVM unit tests
./gradlew connectedDebugAndroidTest # database + Compose UI tests (needs a device/emulator)
./gradlew lintDebug
```

## Toolchain

| | |
|---|---|
| Gradle | 9.7.1 |
| Android Gradle Plugin | 9.3.2 |
| Kotlin | 2.3.21 |
| compileSdk / targetSdk / minSdk | 37 / 36 / 26 |

AGP 9 ships built-in Kotlin support, so the `org.jetbrains.kotlin.android` plugin is declared in
the root build file with `apply false` (to pin the Kotlin version on the build classpath) and is
never applied by a module.

## Licence

Not yet chosen.
