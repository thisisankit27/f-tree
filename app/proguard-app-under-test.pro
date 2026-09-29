# Keeps applied to the APP's R8 run, and only when the instrumented tests are running against a
# minified build (`-Pftree.testBuildType=release`). Never part of a shipping APK: `release.yml`
# and a plain `./gradlew assembleRelease` do not set that property, so they never read this file.
#
# Why this is not just proguard-test-rules.pro, which sounds like it should cover it:
# `testProguardFiles` configures `minifyReleaseAndroidTestWithR8`, the run over the TEST apk. The
# classes the runner dies on are not in the test APK at all. They arrive transitively through the
# app's own dependencies, so AGP leaves them out of the test APK as duplicates, and then
# `minifyReleaseWithR8` drops them from the app because no app code refers to them. Only the app's
# own run can keep them, which is what this file is for.
#
# Found in CI, one per run, each surfacing only once the one before it was kept:
#   androidx.tracing.Trace  - AndroidJUnitRunner.onCreate
#   kotlin.LazyKt           - AndroidJUnitRunner.parseRunnerArgs
# Before the first of them was kept the runner died with a FATAL EXCEPTION before any test, and
# because no result ever came back the Gradle task hung instead of failing.
#
# Kept per package rather than class by class. These three are third-party scaffolding that the
# test harness reaches into from code R8 cannot see, and finding each missing class costs a
# ten-minute emulator run; kotlinx.coroutines is included before it has been seen to fail because
# the test APK reaches into it the same way. kotlin.LazyKt is the illustrative case: `lazy()` is
# inlined wherever app code uses it, so nothing holds the class alive for the runner that needs it.
#
# The line that matters: nothing under com.vibethroughcode is kept here. The app's own classes stay
# fully shrunk, renamed and optimised in the APK under test -- that is where #297-shaped breakage
# lives, and keeping this file off it is what makes the release run worth running.
-keep class androidx.tracing.** { *; }
# Compose's test infrastructure lives in the test APK but drives Compose through classes that live
# in the app. Two of them showed up as 79 failures across every Compose UI test, and nothing else:
#   androidx.compose.ui.platform.InfiniteAnimationPolicy  - how the test rule stops the clock
#   androidx.compose.runtime.Composer                     - reached by name, so renaming breaks it
# Kept per package because ViewRootForTest and the rest of the synchronisation surface sit beside
# them and would each cost another emulator run to discover. Compose's foundation, material,
# animation and ui packages are NOT kept, and neither is any app code.
-keep class androidx.compose.ui.platform.** { *; }
-keep class androidx.compose.runtime.** { *; }
-dontwarn androidx.compose.**
-keep class kotlin.** { *; }
-keep class kotlinx.coroutines.** { *; }
-dontwarn androidx.tracing.**
-dontwarn kotlin.**
-dontwarn kotlinx.coroutines.**
