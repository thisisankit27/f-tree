package com.vibethroughcode.ftree.transfer

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The on-disk shape of an exported family tree.
 *
 * A `.ftree` file is a ZIP holding `tree.json` in this shape plus a `photos/` directory. ZIP rather
 * than one big JSON because base64-encoding a few hundred photographs would triple their size and
 * force the whole tree through memory to read one person's name.
 *
 * Every field except [format] and [version] is optional or defaulted, so a file written by a newer
 * release still parses here; unknown keys are ignored rather than fatal. That, plus [version],
 * is what lets the format grow without stranding files people already have.
 */
@Serializable
data class TreeDocument(
    // Always written, even though they equal their defaults: these two fields are how a reader
    // knows what it is holding and whether it can understand it, so omitting them to save eleven
    // bytes would make the file unidentifiable.
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val format: String = FORMAT,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val version: Int = VERSION,
    val exportedAt: String = "",
    /**
     * Identifies the installation that produced this file.
     *
     * Together with a person's id it forms a stable identity across exports, which is what turns
     * "is this the same person?" from a name-matching guess into a fact when the file is imported
     * — including re-importing a file derived from one this device produced.
     */
    val sourceTreeId: String = "",
    val people: List<PersonRecord> = emptyList(),
    val relationships: List<RelationshipRecord> = emptyList(),
) {
    companion object {
        const val FORMAT = "f-tree"
        const val VERSION = 1
        const val ENTRY_JSON = "tree.json"
        const val ENTRY_PHOTOS = "photos/"
        const val FILE_EXTENSION = "ftree"
        /**
     * Deliberately not `application/zip`: the system file picker appends an extension matching the
     * type, which turned a `.ftree` file into `.ftree.zip`. An opaque type leaves the name alone.
     */
    const val MIME_TYPE = "application/octet-stream"
    }
}

@Serializable
data class PersonRecord(
    val id: String,
    val name: String? = null,
    val gender: String? = null,
    val birthDate: String? = null,
    val deathDate: String? = null,
    val deceased: Boolean = false,
    /** Path within the archive, e.g. `photos/abc.jpg`. Absent when there is no photo. */
    val photo: String? = null,
    val notes: String? = null,
    /**
     * Where this person came from before this export, carried forward so a tree that has already
     * been merged once still matches exactly on a later import.
     */
    val origins: List<OriginRecord> = emptyList(),
)

@Serializable
data class OriginRecord(
    @SerialName("treeId") val treeId: String,
    @SerialName("personId") val personId: String,
)

@Serializable
data class RelationshipRecord(
    val id: String,
    val from: String,
    val to: String,
    val type: String,
    val subtype: String? = null,
)
