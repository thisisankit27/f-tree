package com.vibethroughcode.ftree.data

import java.time.DateTimeException
import java.time.LocalDate

/**
 * A date that may be known only to the year or the month.
 *
 * Family history is full of "born sometime in 1938", so a full [LocalDate] would force people to
 * invent a day they do not know. Stored as a partial ISO-8601 string — `1938`, `1938-04`, or
 * `1938-04-17` — which sorts correctly as text and needs no separate "is approximate" flag: the
 * precision *is* the statement about how much is known.
 */
data class PartialDate(
    val year: Int,
    val month: Int? = null,
    val day: Int? = null,
) : Comparable<PartialDate> {

    /** The ISO-8601 string that gets persisted. */
    fun serialize(): String = when {
        month == null -> "%04d".format(year)
        day == null -> "%04d-%02d".format(year, month)
        else -> "%04d-%02d-%02d".format(year, month, day)
    }

    /** Earliest instant this date could refer to; used for age arithmetic and ordering. */
    fun earliest(): LocalDate = LocalDate.of(year, month ?: 1, day ?: 1)

    /** Latest instant this date could refer to. */
    fun latest(): LocalDate {
        if (month == null) return LocalDate.of(year, 12, 31)
        val firstOfMonth = LocalDate.of(year, month, 1)
        return if (day == null) firstOfMonth.withDayOfMonth(firstOfMonth.lengthOfMonth())
        else firstOfMonth.withDayOfMonth(day)
    }

    /** True when the two dates could describe the same day, allowing for differing precision. */
    fun isCompatibleWith(other: PartialDate): Boolean =
        !earliest().isAfter(other.latest()) && !other.earliest().isAfter(latest())

    override fun compareTo(other: PartialDate): Int = earliest().compareTo(other.earliest())

    override fun toString(): String = serialize()

    companion object {
        private val PATTERN = Regex("""^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$""")

        /** Returns null for anything that is not a well-formed, real partial date. */
        fun parse(value: String?): PartialDate? {
            val match = PATTERN.matchEntire(value?.trim().orEmpty()) ?: return null
            val (y, m, d) = match.destructured
            val year = y.toInt()
            val month = m.takeIf { it.isNotEmpty() }?.toInt()
            val day = d.takeIf { it.isNotEmpty() }?.toInt()
            return try {
                PartialDate(year, month, day).also { it.earliest(); it.latest() }
            } catch (_: DateTimeException) {
                null
            }
        }

        fun ofYear(year: Int): PartialDate = PartialDate(year)
    }
}

/**
 * Whole years between two partial dates, or null when it cannot be stated.
 *
 * Computed from the earliest possible instants, which is the conventional reading of "born in
 * 1938" and keeps the answer stable as precision improves.
 */
fun yearsBetween(from: PartialDate, to: PartialDate): Int? {
    val start = from.earliest()
    val end = to.earliest()
    if (end.isBefore(start)) return null
    return java.time.Period.between(start, end).years
}
