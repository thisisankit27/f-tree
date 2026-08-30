// AGP 9 has built-in Kotlin support, so the Kotlin Android plugin is never *applied* by a
// module. Declaring it here with `apply false` still puts the chosen KGP version on the build
// classpath, which is how AGP's bundled Kotlin (2.2.10) gets overridden.
// See https://developer.android.com/build/releases/agp-9-0-0-release-notes
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
}
