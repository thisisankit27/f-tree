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

/**
 * Stages the family book's engine (#200) and the policy switch (#156) into a variant's generated
 * assets, under `book/`, from the one copy of each in git.
 *
 *  - `book/policy.json` - the shipped policy, read by `PolicyAssets`.
 *  - `book/site/...` - the composer and exactly the modules it imports, at the same relative paths
 *    they have in `site/`, so `../playground/model.js` resolves inside the WebView with no rewriting;
 *    plus the templates. Which modules is not a list anybody maintains: [bookEngine] walks the
 *    imports from `site/book/compose.js`, so a module added to the composer is staged because it is
 *    imported, and a test, a golden or a fixture is never staged because nothing imports it.
 *
 * A dedicated task with a real `@OutputDirectory`, rather than a bare `Copy`, because
 * `Sources.assets.addGeneratedSourceDirectory` wants a task whose output is a `DirectoryProperty`
 * it can wire a task dependency to -- `Copy`'s destination is a plain `File` and cannot be wired
 * that way.
 */
@CacheableTask
abstract class SyncBookAssets : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val policyJson: RegularFileProperty

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val engine: ConfigurableFileCollection

    /** Where [engine]'s paths are measured from - the repository's `site/`. */
    @get:Internal
    abstract val siteRoot: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun sync() {
        val root = outputDir.get().asFile
        root.deleteRecursively()
        val book = root.resolve("book").apply { mkdirs() }
        policyJson.get().asFile.copyTo(book.resolve("policy.json"), overwrite = true)
        val site = siteRoot.get().asFile
        engine.files.forEach { it.copyTo(book.resolve("site").resolve(it.relativeTo(site).path), overwrite = true) }
    }
}

/** Every module `site/book/compose.js` imports, transitively, plus the templates it reads. */
fun bookEngine(site: File): List<File> {
    val found = linkedSetOf<File>()
    val queue = ArrayDeque(listOf(site.resolve("book/compose.js").canonicalFile))
    val specifier = Regex("""^\s*(?:import|export)\b[^'"]*['"](\.{1,2}/[^'"]+)['"]""", RegexOption.MULTILINE)
    while (queue.isNotEmpty()) {
        val file = queue.removeFirst()
        if (!found.add(file)) continue
        check(file.startsWith(site.canonicalFile)) { "the book engine imports ${file} from outside site/" }
        specifier.findAll(file.readText()).forEach { queue.add(file.parentFile.resolve(it.groupValues[1]).canonicalFile) }
    }
    return found.toList() + (site.resolve("book/templates").listFiles { f -> f.extension == "json" }?.sorted() ?: emptyList())
}

android {
    namespace = "com.vibethroughcode.ftree"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.vibethroughcode.ftree"
        minSdk = 26
        targetSdk = 36
        versionCode = 31
        versionName = "0.10.0-beta.3"

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

    // `BookFormat2PdfTest` paints the format-2 conformance book on a device, read from the one copy
    // in git. Test APK only: the app itself never ships a golden.
    sourceSets {
        getByName("androidTest") {
            assets.srcDir(rootProject.file("site/book/golden"))
        }
    }
}

// Emit the Room schema so migrations can be written against a checked-in history.
ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

// One copy of the book engine and the policy in git, staged into each variant's assets by
// `SyncBookAssets` above -- never a second copy checked in under app/src.
androidComponents {
    onVariants { variant ->
        val syncTask = tasks.register<SyncBookAssets>("sync${variant.name.replaceFirstChar { it.uppercase() }}BookAssets") {
            policyJson.set(rootProject.file("site/book/policy.json"))
            siteRoot.set(rootProject.layout.projectDirectory.dir("site"))
            engine.from(bookEngine(rootProject.file("site")))
            outputDir.set(layout.buildDirectory.dir("generated/bookAssets/${variant.name}"))
        }
        variant.sources.assets?.addGeneratedSourceDirectory(syncTask) { it.outputDir }
    }
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

    // QR quick-connect for nearby sharing (#172). ZXing core is pure Java with no transitive
    // dependencies and no network; the app uses its QR reader and encoder and R8 discards the rest.
    // CameraX is AndroidX, from the same family as everything above. Both buy convenience, not
    // capability: a device with no camera, or with the permission refused, types the address and
    // compares six digits instead.
    implementation(libs.zxing.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(libs.androidx.junit)
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

    /*
     * The JavaScript half of the nearby protocol, and the tree the cross-language test sends.
     *
     * `CrossLanguageTransferTest` runs this module's Kotlin against `desktop/nearby/` in a real
     * `node` process, so those files are genuinely inputs to this task even though Gradle has no
     * other reason to think so. Without this the test is considered up to date when only the
     * JavaScript has changed -- which is exactly the change it exists to catch, and it would pass
     * by not running. Verified by breaking a label on the JS side: unregistered, the task is
     * skipped and reports success.
     */
    inputs.files(
        fileTree(rootProject.file("desktop/nearby")) { include("**/*.js") },
        rootProject.file("site/playground/sample-family.ftree"),
    ).withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("nearbyCrossLanguageInputs")
        .optional()

    /*
     * `PolicyCasesTest` reads `site/book/policy.json` and `site/book/policy-cases.json` by a
     * project-relative path, the same way it reads `entitlement/Entitlements.kt` through the
     * compiled classpath and `CrossLanguageTransferTest` reads `sample-family.ftree` above --
     * these two files are genuine inputs even though Gradle has no other reason to know that a
     * plain JSON file feeds a JVM test. Without this, editing only the shared table would leave
     * the task up to date and the new case would pass by not running.
     */
    inputs.files(
        rootProject.file("site/book/policy.json"),
        rootProject.file("site/book/policy-cases.json"),
    ).withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("policyCasesInputs")
        .optional()

    /*
     * `DateCasesTest` and `DateEntryTest`: the date grammar and the date field's shared tables (#90);
     * `OccasionCasesTest`: whose birthday falls when (#230).
     */
    inputs.files(
        rootProject.file("site/playground/date-cases.json"),
        rootProject.file("desktop/renderer/date-entry-cases.json"),
        rootProject.file("site/playground/occasion-cases.json"),
    )
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("dateCasesInputs")
        .optional()

    /* The same again for `BookCatalogTest`: the catalogue's shared table, and the format it gates on. */
    inputs.files(
        rootProject.file("site/book/catalog-cases.json"),
        rootProject.file("site/book/templates/catalog.json"),
        rootProject.file("site/book/template.js"),
    ).withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("catalogCasesInputs")
        .optional()

    /*
     * The other half of the same problem, for `branchFrom`.
     *
     * `BranchCasesTest` checks this module's `FamilyGraph.branchFrom` against `branch-cases.json`,
     * a table shared with `site/playground/branch.test.mjs` -- see that file's header for why the
     * table is computed independently of both ports rather than generated by either one. Gradle has
     * no way to know the JSON or the JS engine it is proved against are inputs to this Kotlin test
     * unless told, so without this the task goes stale exactly when a change to either would matter.
     */
    inputs.files(
        rootProject.file("site/playground/branch-cases.json"),
        rootProject.file("site/playground/model.js"),
    ).withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("branchCrossLanguageInputs")
        .optional()

    /*
     * `BookFormatTest` parses the composer's own golden book and runs the composer in node against
     * a document the app's exporter types encoded - so the whole engine is an input to it.
     * compose.js also reaches into site/playground, so the closure comes from [bookEngine], the
     * same walk that decides what ships into the WebView, rather than a hand-kept list that went
     * stale once story/featured.js imported focus.js (#244).
     */
    inputs.files(
        fileTree(rootProject.file("site/book")) { include("**/*.js", "**/*.json") },
        bookEngine(rootProject.file("site")),
    ).withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("bookEngineInputs")
        .optional()
}
