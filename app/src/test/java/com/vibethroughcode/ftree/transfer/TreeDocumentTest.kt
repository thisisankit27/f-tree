package com.vibethroughcode.ftree.transfer

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The format's compatibility promises, which are what stop a future release from stranding files
 * people already have.
 */
class TreeDocumentTest {

    private val json: Json = ExportJson

    private fun document() = TreeDocument(
        exportedAt = "2026-08-31T00:00:00Z",
        sourceTreeId = "tree-a",
        people = listOf(
            PersonRecord(
                id = "p1",
                name = "Ankit Kumar",
                gender = "MALE",
                birthDate = "1990-05-01",
                photo = "photos/a.jpg",
                origins = listOf(OriginRecord("tree-z", "old-1")),
            ),
            PersonRecord(id = "p2"),
        ),
        relationships = listOf(RelationshipRecord("r1", "p2", "p1", "PARENT")),
    )

    @Test
    fun `a document survives a round trip unchanged`() {
        val original = document()
        val restored = json.decodeFromString<TreeDocument>(json.encodeToString(original))
        assertEquals(original, restored)
    }

    @Test
    fun `a person with nothing recorded round trips`() {
        val restored = json.decodeFromString<TreeDocument>(json.encodeToString(document()))
        val unknown = restored.people.single { it.id == "p2" }

        assertNull(unknown.name)
        assertNull(unknown.birthDate)
        assertFalse(unknown.deceased)
    }

    @Test
    fun `defaults are left out so the file stays small`() {
        val encoded = json.encodeToString(document())

        // p2 has nothing set, so it should encode as little more than its id.
        assertFalse(encoded.contains("\"deceased\":false"))
        assertTrue(encoded.contains("\"p2\""))
    }

    @Test
    fun `a file from a newer version still opens`() {
        // A future release adds fields and a new relationship type; neither should be fatal.
        val fromTheFuture = """
            {
              "format": "f-tree",
              "version": 1,
              "sourceTreeId": "tree-b",
              "burialPlace": "somewhere",
              "people": [
                {"id": "p1", "name": "Ankit", "nickname": "Anki", "pronouns": "he/him"}
              ],
              "relationships": [
                {"id": "r1", "from": "p1", "to": "p2", "type": "GODPARENT", "certainty": "high"}
              ]
            }
        """.trimIndent()

        val parsed = json.decodeFromString<TreeDocument>(fromTheFuture)

        assertEquals("Ankit", parsed.people.single().name)
        assertEquals("GODPARENT", parsed.relationships.single().type)
    }

    @Test
    fun `origins are carried so a re-import can match exactly`() {
        val restored = json.decodeFromString<TreeDocument>(json.encodeToString(document()))
        val origin = restored.people.first { it.id == "p1" }.origins.single()

        assertEquals("tree-z", origin.treeId)
        assertEquals("old-1", origin.personId)
    }

    @Test
    fun `the format and version are written into the file itself`() {
        val encoded = json.encodeToString(document())

        // Asserting on the encoded text, not on a decoded object: decoding would fall back to the
        // defaults and quietly hide their absence, which is exactly the bug this guards against.
        assertTrue(encoded, encoded.contains("\"format\":\"f-tree\""))
        assertTrue(encoded, encoded.contains("\"version\":1"))
    }

    @Test
    fun `a file with no format or version is still readable as version one`() {
        val bare = """{"people":[{"id":"p1","name":"Ankit"}]}"""

        val parsed = json.decodeFromString<TreeDocument>(bare)

        assertEquals("f-tree", parsed.format)
        assertEquals(1, parsed.version)
    }
}
