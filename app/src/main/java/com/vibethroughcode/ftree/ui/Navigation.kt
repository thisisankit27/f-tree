package com.vibethroughcode.ftree.ui

import com.vibethroughcode.ftree.data.RelativeKind
import kotlinx.serialization.Serializable

/**
 * Type-safe navigation routes.
 *
 * Serializable objects rather than string templates, so a missing or misspelled argument is a
 * compile error instead of a crash on a device.
 */
@Serializable
data object PeopleRoute

@Serializable
data class PersonRoute(val personId: String)

/** A null [personId] means "create someone new". */
@Serializable
data class EditPersonRoute(val personId: String? = null)

/** Picking who to attach to [anchorPersonId] as a [kind]. */
@Serializable
data class AddRelativeRoute(val anchorPersonId: String, val kind: RelativeKind)
