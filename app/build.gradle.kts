import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// Signing details live outside version control. Without them a release build is still produced,
// just unsigned, so the project stays buildable by anyone who clones it.
val signingProperties = rootProject.file("keystore.properties").takeIf { it.exists() }?.let {
    Properties().apply { it.inputStream().use(::load) }
}

android {
    namespace = "com.vibethroughcode.ftree"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.vibethroughcode.ftree"
        minSdk = 26
        targetSdk = 36
        versionCode = 20
        versionName = "0.7.0-beta.4"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Where the optional updater looks. Here rather than in Kotlin so a fork points at its own
        // releases by editing one line, and so the single network endpoint is visible in the build.
        buildConfigField(
            "String",
            "UPDATE_RELEASE_URL",
            "\"https://api.github.com/repos/thisisankit27/f-tree/releases/latest\"",
        )
        // Every release, newest first. `releases/latest` deliberately skips pre-releases, so the
        // beta channel has to read the list instead.
        buildConfigField(
            "String",
            "UPDATE_RELEASES_URL",
            "\"https://api.github.com/repos/thisisankit27/f-tree/releases?per_page=20\"",
        )
        buildConfigField(
            "String",
            "RELEASES_PAGE_URL",
            "\"https://github.com/thisisankit27/f-tree/releases\"",
        )
        // Where somebody who has been sent a family goes to get the app. Here for the same reason
        // as the two above: a fork points at its own place by editing one line.
        buildConfigField(
            "String",
            "SITE_URL",
            "\"https://ftree.vibethroughcode.com\"",
        )
    }

    signingConfigs {
        if (signingProperties != null) {
            create("release") {
                storeFile = file(signingProperties.getProperty("storeFile"))
                storePassword = signingProperties.getProperty("storePassword")
                keyAlias = signingProperties.getProperty("keyAlias")
                keyPassword = signingProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

// Emit the Room schema so migrations can be written against a checked-in history.
ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.coil.compose)
    implementation(libs.androidx.exifinterface)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.room.testing)
    androidTestImplementation(libs.kotlinx.coroutines.test)
}

/**
 * Lets the Hindi kinship sweep run against a real exported tree rather than only the built-in one:
 *
 *     ./gradlew testDebugUnitTest -Dftree.tree=temp/family-tree.ftree
 *
 * Forwarded explicitly because a `-D` on the Gradle command line reaches the daemon, not the JVM the
 * tests run in. Absent, the sweep uses its own family and the real-tree case is skipped.
 */
tasks.withType<Test>().configureEach {
    System.getProperty("ftree.tree")?.let { systemProperty("ftree.tree", it) }
}
