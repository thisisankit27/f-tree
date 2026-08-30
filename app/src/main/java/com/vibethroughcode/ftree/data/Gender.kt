package com.vibethroughcode.ftree.data

/**
 * Recorded only because it is what lets the app say "Father" instead of "Parent" and pick a
 * default avatar. It is never required, and [UNSPECIFIED] is a first-class answer.
 */
enum class Gender {
    MALE,
    FEMALE,
    OTHER,
    UNSPECIFIED,
}
