package com.vibethroughcode.ftree.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class PersonTest {

    private val today = LocalDate.of(2026, 8, 30)

    @Test
    fun `a person with no details at all is valid and unnamed`() {
        val unknown = Person()
        assertTrue(unknown.isUnnamed)
        assertNull(unknown.age(today))
    }

    @Test
    fun `blank names count as unnamed`() {
        assertTrue(Person(name = "   ").isUnnamed)
        assertFalse(Person(name = "Ankit").isUnnamed)
    }

    @Test
    fun `age is derived from the birth date`() {
        val person = Person(name = "Ankit", birthDate = "1990-05-01")
        assertEquals(36, person.age(today))
    }

    @Test
    fun `a birthday later this year has not happened yet`() {
        val person = Person(name = "Ankit", birthDate = "1990-12-01")
        assertEquals(35, person.age(today))
    }

    @Test
    fun `a year-only birth date still yields an age`() {
        assertEquals(88, Person(birthDate = "1938").age(today))
    }

    @Test
    fun `age at death is used once someone has died`() {
        val person = Person(name = "Grandfather", birthDate = "1938", deathDate = "2010", deceased = true)
        assertEquals(72, person.age(today))
    }

    @Test
    fun `no age is claimed for someone known dead on an unknown date`() {
        val person = Person(name = "Grandfather", birthDate = "1938", deceased = true)
        assertNull(person.age(today))
    }
}
