package com.vibethroughcode.ftree.ui

import com.vibethroughcode.ftree.data.RelativeKind
import kotlinx.serialization.Serializable

/**
 * Type-safe navigation routes.
 *
 * Serializable objects rather than string templates, so a missing or misspelled argument is a
 * compile error instead of a crash on a device.
 */
/**
 * The chart is home; it is what the app is for.
 *
 * [focusId] is how a person's page says "show me here". It shares a name with the key the view
 * model persists focus under, so a focus arrived at by navigating and one restored after process
 * death are the same value in the same slot rather than two competing sources of truth.
 */
@Serializable
data class TreeRoute(val focusId: String? = null)

@Serializable
data object PeopleRoute

@Serializable
data class PersonRoute(val personId: String)

/** A null [personId] means "create someone new". */
@Serializable
data class EditPersonRoute(val personId: String? = null)

@Serializable
data object SettingsRoute

/** Picking who to attach to [anchorPersonId] as a [kind]. */
@Serializable
data class AddRelativeRoute(val anchorPersonId: String, val kind: RelativeKind)
