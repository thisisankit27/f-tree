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
# The instrumented tests name app types, and R8 is free to restructure them. It removes the three
# Room DAO interfaces outright -- usage.txt lists 37 entries for RelationshipDao and 33 for
# PersonDao, while mapping.txt shows only their generated _Impl classes surviving -- which is
# vertical merging of an interface that has exactly one implementation.
#
# That is correct, and it is NOT a bug in the shipping app: nothing in the app looks these up by
# name, so R8 rewrites every reference consistently and release builds work. It breaks only the
# test APK, which asks for `com.vibethroughcode.ftree.data.RelationshipDao` through reflection on
# a DAO accessor's return type. Remapping cannot rescue that -- a class merged away has no mapping
# target to rewrite to -- so the interface has to survive in the APK under test.
#
# Three interfaces, named by shape rather than a package wildcard, so the rest of the data layer
# (and every other package the app owns) keeps being shrunk, renamed and merged.
-keep interface com.vibethroughcode.ftree.data.*Dao { *; }

# androidx.room.Room is the facade, and the app only ever reaches it through
# `Room.databaseBuilder(...)`, a static call R8 inlines -- after which nothing holds the class and
# it goes. The tests build their databases with `Room.inMemoryDatabaseBuilder(...)`, so they need
# the class itself to still be there. Same shape as the DAOs: correct for the app, fatal for a
# test APK that names it.
-keep class androidx.room.Room { *; }

# ViewTreeLifecycleOwner is the other half of the Compose test rule's reach into the app.
-keep class androidx.lifecycle.ViewTree* { *; }
-keep class androidx.savedstate.ViewTree* { *; }

-dontwarn androidx.tracing.**
-dontwarn kotlin.**
-dontwarn kotlinx.coroutines.**
