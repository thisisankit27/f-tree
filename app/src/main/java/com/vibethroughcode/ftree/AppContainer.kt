package com.vibethroughcode.ftree

import android.content.Context
import com.vibethroughcode.ftree.data.FTreeDatabase
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.PhotoStore
import com.vibethroughcode.ftree.transfer.TreeExporter
import com.vibethroughcode.ftree.transfer.TreeIdentity
import com.vibethroughcode.ftree.transfer.TreeImporter
import com.vibethroughcode.ftree.update.ApkGuard
import com.vibethroughcode.ftree.update.UpdateClient
import com.vibethroughcode.ftree.update.UpdateInstaller
import com.vibethroughcode.ftree.update.UpdatePreferences
import com.vibethroughcode.ftree.update.UpdateRepository

/**
 * Hand-rolled dependency wiring.
 *
 * The app has a handful of screens and one repository; a DI framework would add a compiler plugin
 * and a layer of indirection to solve a problem this size does not have. Tests construct the
 * repository directly against an in-memory database.
 */
class AppContainer(context: Context) {
    /** Public so instrumented tests can call `clearAllTables()` between runs. */
    val database: FTreeDatabase by lazy { FTreeDatabase.build(context) }
    val familyRepository: FamilyRepository by lazy { FamilyRepository(database, photoStore) }
    val photoStore: PhotoStore by lazy { PhotoStore(context.applicationContext) }
    val treeIdentity: TreeIdentity by lazy { TreeIdentity(context.applicationContext) }
    val exporter: TreeExporter by lazy { TreeExporter(familyRepository, photoStore, treeIdentity) }
    val importer: TreeImporter by lazy {
        TreeImporter(
            database = database,
            repository = familyRepository,
            photos = photoStore,
            identity = treeIdentity,
            exporter = exporter,
            workingDirectory = context.applicationContext.filesDir,
        )
    }

    val updatePreferences: UpdatePreferences by lazy { UpdatePreferences(context) }

    /**
     * Built lazily like everything else, which also means the updater's objects do not exist at
     * all in a session where nobody opens Settings.
     */
    val updateRepository: UpdateRepository by lazy {
        UpdateRepository(
            preferences = updatePreferences,
            client = UpdateClient(),
            guard = ApkGuard(context.applicationContext),
            installer = UpdateInstaller(context.applicationContext),
        )
    }
}
