# Keeps applied to the APP's R8 run, and only when the instrumented tests are running against a
# minified build (`-Pftree.testBuildType=release`). Never part of a shipping APK: `release.yml`
# and a plain `./gradlew assembleRelease` do not set that property, so they never read this file.
#
# Why this is not proguard-test-rules.pro, which sounds like it should cover it: `testProguardFiles`
# configures `minifyReleaseAndroidTestWithR8`, the run over the TEST apk. These classes are not in
# the test APK at all -- they arrive in the app transitively, AGP leaves them out as duplicates,
# and then `minifyReleaseWithR8` drops them from the app because no app code names them. Only the
# app's own run can keep them.
#
# The list below is DERIVED, not discovered one crash at a time. `.github/scripts/missing-under-test.py`
# intersects the test APK's dex type table with usage.txt, which is every class R8 discarded, and
# prints the whole set after a single assemble. Regenerate it rather than adding to it by hand:
#
#   python3 .github/scripts/missing-under-test.py \
#     app/build/outputs/apk/androidTest/release/app-release-androidTest.apk \
#     app/build/outputs/mapping/release/usage.txt
#
# Everything here is third-party scaffolding the instrumentation harness reaches into. Keeping it
# hides nothing: the breakage this leg exists to catch (#297-shaped -- the book engine and
# kotlinx-serialization under minification) lives in app code, and NOTHING under
# com.vibethroughcode is kept, so app code stays shrunk, renamed and merged.


# androidx.tracing / the runner's own startup path.
-keep class androidx.tracing.** { *; }

# the Kotlin stdlib and coroutine runtime the harness reaches by name.
-keep class kotlin.** { *; }
-keep class kotlinx.coroutines.** { *; }

# the Compose surface the test rule drives.
-keep class androidx.compose.ui.platform.** { *; }
-keep class androidx.compose.runtime.** { *; }

# the Room facade the tests build their databases with.
-keep class androidx.room.Room { *; }

# ViewTree owners, the other half of the test rule's reach.
-keep class androidx.lifecycle.ViewTree* { *; }
-keep class androidx.savedstate.ViewTree* { *; }

# The derived set: every other third-party class the test APK names and R8 removed.
-keep class androidx.compose.foundation.layout.BoxScopeInstance { *; }
-keep class androidx.compose.runtime.CompositionContext { *; }
-keep class androidx.compose.runtime.CompositionLocal { *; }
-keep class androidx.compose.runtime.DisposableEffectScope { *; }
-keep class androidx.compose.runtime.ProvidableCompositionLocal { *; }
-keep class androidx.compose.runtime.ProvidedValue { *; }
-keep class androidx.compose.ui.Alignment$Companion { *; }
-keep class androidx.compose.ui.ComposedModifierKt { *; }
-keep class androidx.compose.ui.geometry.Offset$Companion { *; }
-keep class androidx.compose.ui.geometry.OffsetKt { *; }
-keep class androidx.compose.ui.geometry.RectKt { *; }
-keep class androidx.compose.ui.graphics.ImageBitmap { *; }
-keep class androidx.compose.ui.input.indirect.AndroidIndirectPointerEvent_androidKt { *; }
-keep class androidx.compose.ui.input.indirect.IndirectPointerEventType { *; }
-keep class androidx.compose.ui.input.indirect.IndirectPointerEventType$Companion { *; }
-keep class androidx.compose.ui.input.key.Key$Companion { *; }
-keep class androidx.compose.ui.input.key.KeyEvent_androidKt { *; }
-keep class androidx.compose.ui.input.pointer.PointerId { *; }
-keep class androidx.compose.ui.input.pointer.util.VelocityTracker { *; }
-keep class androidx.compose.ui.layout.LayoutCoordinatesKt { *; }
-keep class androidx.compose.ui.layout.LayoutInfo { *; }
-keep class androidx.compose.ui.layout.SubcomposeLayoutKt { *; }
-keep class androidx.compose.ui.node.ComposeUiNode$Companion { *; }
-keep class androidx.compose.ui.platform.AbstractComposeView { *; }
-keep class androidx.compose.ui.semantics.CustomAccessibilityAction { *; }
-keep class androidx.compose.ui.semantics.SemanticsOwnerKt { *; }
-keep class androidx.compose.ui.text.font.FontFamilyResolver_androidKt { *; }
-keep class androidx.compose.ui.text.input.ImeAction$Companion { *; }
-keep class androidx.compose.ui.unit.Constraints$Companion { *; }
-keep class androidx.compose.ui.unit.Dp$Companion { *; }
-keep class androidx.compose.ui.unit.DpKt { *; }
-keep class androidx.compose.ui.unit.DpRect { *; }
-keep class androidx.compose.ui.unit.IntSizeKt { *; }
-keep class androidx.compose.ui.util.MathHelpersKt { *; }
-keep class androidx.compose.ui.window.DialogWindowProvider { *; }
-keep class androidx.concurrent.futures.CallbackToFutureAdapter { *; }
-keep class androidx.core.os.ConfigurationCompat { *; }
-keep class androidx.core.view.ViewConfigurationCompat { *; }
-keep class androidx.core.view.ViewGroupKt { *; }
-keep class androidx.lifecycle.ViewModelStoreOwnerDefaults { *; }
-keep class androidx.lifecycle.viewmodel.compose.ViewModelKt { *; }
-keep class androidx.room.BaseRoomConnectionManager { *; }
-keep class androidx.room.RoomDatabase$MigrationContainer { *; }
-keep class androidx.room.RoomDatabase$PrepackagedDatabaseCallback { *; }
-keep class androidx.room.migration.AutoMigrationSpec { *; }
-keep class androidx.room.migration.Migration { *; }
-keep class androidx.room.util.FtsTableInfo { *; }
-keep class androidx.room.util.FtsTableInfo$Companion { *; }
-keep class androidx.room.util.TableInfo$Companion { *; }
-keep class androidx.room.util.ViewInfo { *; }
-keep class androidx.room.util.ViewInfo$Companion { *; }
-keep class androidx.sqlite.SQLite { *; }
-keep class androidx.sqlite.db.SupportSQLiteDatabase { *; }
-keep class androidx.sqlite.db.SupportSQLiteOpenHelper$Callback { *; }
-keep class androidx.sqlite.db.SupportSQLiteOpenHelper$Configuration { *; }
-keep class androidx.sqlite.db.SupportSQLiteOpenHelper$Configuration$Builder { *; }
-keep class androidx.sqlite.db.SupportSQLiteOpenHelper$Configuration$Companion { *; }
-keep class androidx.sqlite.db.SupportSQLiteOpenHelper$Factory { *; }
-keep class androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory { *; }
-keep class androidx.sqlite.driver.SupportSQLiteDriver { *; }
-keep class kotlin.collections.ArraysKt { *; }
-keep class kotlin.collections.MapsKt { *; }
-keep class kotlin.ranges.RangesKt { *; }
-keep class kotlinx.coroutines.internal.MainDispatchersKt { *; }
-keep class kotlinx.serialization.DeserializationStrategy { *; }
-keep class kotlinx.serialization.SerialName { *; }
-keep class kotlinx.serialization.SerializationStrategy { *; }
-keep class kotlinx.serialization.internal.PluginExceptionsKt { *; }
-keep class kotlinx.serialization.json.JsonContentPolymorphicSerializer { *; }
-keep class kotlinx.serialization.json.JsonElementBuildersKt { *; }
-keep class kotlinx.serialization.json.JsonKt { *; }
-keep class kotlinx.serialization.json.JvmStreamsKt { *; }
-keep class kotlinx.serialization.modules.SerializersModule { *; }
-keep class kotlinx.serialization.modules.SerializersModuleBuilder { *; }

-dontwarn androidx.**
-dontwarn kotlin.**
-dontwarn kotlinx.**
