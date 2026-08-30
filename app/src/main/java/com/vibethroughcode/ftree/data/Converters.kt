package com.vibethroughcode.ftree.data

import androidx.room.TypeConverter

/** Enums are persisted by name so the stored value stays readable and stable across releases. */
class Converters {
    @TypeConverter
    fun genderToString(value: Gender): String = value.name

    @TypeConverter
    fun stringToGender(value: String?): Gender =
        Gender.entries.firstOrNull { it.name == value } ?: Gender.UNSPECIFIED

    @TypeConverter
    fun relationshipTypeToString(value: RelationshipType): String = value.name

    @TypeConverter
    fun stringToRelationshipType(value: String?): RelationshipType = RelationshipType.fromName(value)
}
