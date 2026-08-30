package com.vibethroughcode.ftree.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class PartialDateTest {

    @Test
    fun `parses all three precisions`() {
        assertEquals(PartialDate(1938), PartialDate.parse("1938"))
        assertEquals(PartialDate(1938, 4), PartialDate.parse("1938-04"))
        assertEquals(PartialDate(1938, 4, 17), PartialDate.parse("1938-04-17"))
    }

    @Test
    fun `rejects malformed and impossible dates`() {
        assertNull(PartialDate.parse(null))
        assertNull(PartialDate.parse(""))
        assertNull(PartialDate.parse("38"))
        assertNull(PartialDate.parse("1938-4-17"))
        assertNull(PartialDate.parse("1938-13"))
        assertNull(PartialDate.parse("1938-02-30"))
        assertNull(PartialDate.parse("not a date"))
    }

    @Test
    fun `round trips through serialisation`() {
        listOf("1938", "1938-04", "1938-04-17").forEach {
            assertEquals(it, PartialDate.parse(it)!!.serialize())
        }
    }

    @Test
    fun `a year spans the whole year`() {
        val year = PartialDate.parse("1938")!!
        assertEquals(LocalDate.of(1938, 1, 1), year.earliest())
        assertEquals(LocalDate.of(1938, 12, 31), year.latest())
    }

    @Test
    fun `a month spans that month including a leap day`() {
        val february = PartialDate.parse("2024-02")!!
        assertEquals(LocalDate.of(2024, 2, 1), february.earliest())
        assertEquals(LocalDate.of(2024, 2, 29), february.latest())
    }

    @Test
    fun `dates of differing precision are compatible when they could be the same day`() {
        val year = PartialDate.parse("1938")!!
        val exact = PartialDate.parse("1938-04-17")!!
        val otherYear = PartialDate.parse("1939")!!

        assertTrue(year.isCompatibleWith(exact))
        assertTrue(exact.isCompatibleWith(year))
        assertFalse(year.isCompatibleWith(otherYear))
    }

    @Test
    fun `orders by earliest possible instant`() {
        val sorted = listOf("1940", "1938-04-17", "1938").mapNotNull(PartialDate::parse).sorted()
        assertEquals(listOf("1938", "1938-04-17", "1940"), sorted.map { it.serialize() })
    }

    @Test
    fun `displays only as precisely as the date is known`() {
        val uk = java.util.Locale.UK
        assertEquals("1938", PartialDate.parse("1938")!!.display(uk))
        assertEquals("April 1938", PartialDate.parse("1938-04")!!.display(uk))
        assertEquals("17 April 1938", PartialDate.parse("1938-04-17")!!.display(uk))
    }

    @Test
    fun `years between is null when the end precedes the start`() {
        val born = PartialDate.parse("1990")!!
        val died = PartialDate.parse("1980")!!
        assertNull(yearsBetween(born, died))
    }

    @Test
    fun `years between counts whole years`() {
        assertEquals(42, yearsBetween(PartialDate.parse("1938-04-17")!!, PartialDate.parse("1980-05-01")!!))
        assertEquals(41, yearsBetween(PartialDate.parse("1938-04-17")!!, PartialDate.parse("1980-03-01")!!))
    }
}
