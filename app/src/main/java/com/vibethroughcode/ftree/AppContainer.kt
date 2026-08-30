package com.vibethroughcode.ftree

import android.content.Context
import com.vibethroughcode.ftree.data.FTreeDatabase
import com.vibethroughcode.ftree.data.FamilyRepository

/**
 * Hand-rolled dependency wiring.
 *
 * The app has a handful of screens and one repository; a DI framework would add a compiler plugin
 * and a layer of indirection to solve a problem this size does not have. Tests construct the
 * repository directly against an in-memory database.
 */
class AppContainer(context: Context) {
    private val database: FTreeDatabase by lazy { FTreeDatabase.build(context) }
    val familyRepository: FamilyRepository by lazy { FamilyRepository(database) }
}
