# Keeps applied to the APP's R8 run, and only when the instrumented tests are running against a
# minified build (`-Pftree.testBuildType=release`). Never part of a shipping APK: `release.yml`
# and a plain `./gradlew assembleRelease` do not set that property, so they do not read this file.
#
# Why this exists separately from proguard-test-rules.pro, which sounds like it should cover it:
# `testProguardFiles` configures `minifyReleaseAndroidTestWithR8`, the run over the TEST apk. The
# class the runner dies on is not in the test APK at all. androidx.tracing arrives transitively
# through the app's own dependencies, so AGP leaves it out of the test APK as a duplicate, and
# then `minifyReleaseWithR8` drops it from the app because no app code refers to it. Only the app
# can keep it, which is what this file is for. Proved in CI: with the keep in testProguardFiles
# alone, AndroidJUnitRunner still died with
#
#   FATAL EXCEPTION: main
#   java.lang.NoClassDefFoundError: Failed resolution of: Landroidx/tracing/Trace;
#
# before a single test ran -- and because no result ever came back, the Gradle task then hung
# rather than failing.
#
# Deliberately narrow. The broad `-keep class kotlin.** { *; }` that is fine in the test APK would
# be actively harmful here: it would stop R8 shrinking and renaming the stdlib in the very APK
# under test, and so hide the class of breakage (#297) this whole release run exists to catch.
# Anything added here should be test-harness scaffolding the app itself never calls, and nothing
# else.
-keep class androidx.tracing.Trace { *; }
-dontwarn androidx.tracing.**
