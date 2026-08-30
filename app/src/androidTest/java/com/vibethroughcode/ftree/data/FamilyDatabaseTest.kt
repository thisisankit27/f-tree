package com.vibethroughcode.ftree.data

import android.content.Context
import android.database.sqlite.SQLiteConstraintException
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Exercises the schema itself: that the graph survives a round trip, that the database refuses
 * invalid states on its own, and that the two deletion modes behave differently in the way the
 * product depends on.
 */
@RunWith(AndroidJUnit4::class)
class FamilyDatabaseTest {

    private lateinit var db: FTreeDatabase
    private lateinit var people: PersonDao
    private lateinit var edges: RelationshipDao

    @Before
    fun setUp() {
        val context: Context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, FTreeDatabase::class.java)
            .addCallback(FTreeDatabase.enforceForeignKeys)
            .build()
        people = db.personDao()
        edges = db.relationshipDao()
    }

    @After
    fun tearDown() = db.close()

    private suspend fun person(id: String, name: String? = null, birth: String? = null): Person =
        Person(id = id, name = name, birthDate = birth).also { people.insert(it) }

    private suspend fun parentOf(parent: String, child: String) =
        edges.insert(Relationship.of(parent, child, RelationshipType.PARENT))

    @Test
    fun personRoundTripsThroughTheDatabase() = runTest {
        val stored = Person(
            id = "p1",
            name = "Ankit",
            gender = Gender.MALE,
            birthDate = "1990-05-01",
            notes = "note",
        )
        people.insert(stored)

        assertEquals(stored, people.findById("p1"))
    }

    @Test
    fun aPersonWithNoDetailsAtAllCanBeStored() = runTest {
        people.insert(Person(id = "unknown"))

        val loaded = people.findById("unknown")!!
        assertTrue(loaded.isUnnamed)
        assertNull(loaded.name)
    }

    @Test
    fun unknownPeopleSortAfterNamedOnes() = runTest {
        person("b", "Zoe")
        person("a", "Adam")
        person("c")

        val order = people.observeAll().first().map { it.id }
        assertEquals(listOf("a", "b", "c"), order)
    }

    @Test
    fun theUniqueIndexRejectsADuplicateEdge() = runTest {
        person("parent"); person("child")
        parentOf("parent", "child")

        try {
            parentOf("parent", "child")
            throw AssertionError("expected the unique index to reject the duplicate")
        } catch (_: SQLiteConstraintException) {
            // expected
        }
    }

    @Test
    fun aSpouseEdgeIsTheSameRowFromEitherDirection() = runTest {
        person("zoe"); person("adam")
        edges.insert(Relationship.of("zoe", "adam", RelationshipType.SPOUSE))

        try {
            edges.insert(Relationship.of("adam", "zoe", RelationshipType.SPOUSE))
            throw AssertionError("expected canonical ordering to make this a duplicate")
        } catch (_: SQLiteConstraintException) {
            // expected
        }
        assertEquals(1, edges.allRelationships().size)
    }

    @Test
    fun anEdgeToAPersonWhoDoesNotExistIsRejected() = runTest {
        person("real")
        try {
            parentOf("real", "ghost")
            throw AssertionError("expected the foreign key to reject the dangling edge")
        } catch (_: SQLiteConstraintException) {
            // expected
        }
    }

    @Test
    fun deletingCompletelyCascadesToEveryEdge() = runTest {
        person("father"); person("me"); person("child")
        parentOf("father", "me")
        parentOf("me", "child")

        people.deleteById("me")

        assertNull(people.findById("me"))
        assertEquals(emptyList<Relationship>(), edges.allRelationships())
        assertEquals(2, people.count())
    }

    @Test
    fun keepingAsUnknownPreservesEveryRelationship() = runTest {
        person("father", "Raj"); person("me", "Ankit"); person("child", "Kid")
        parentOf("father", "me")
        parentOf("me", "child")

        people.clearDetails("me")

        val stripped = people.findById("me")!!
        assertTrue(stripped.isUnnamed)
        assertEquals(Gender.UNSPECIFIED, stripped.gender)
        // The shape of the family is untouched.
        assertEquals(2, edges.edgeCount("me"))
        assertEquals(listOf("Raj"), edges.observeParents("me").first().map { it.name })
        assertEquals(listOf("Kid"), edges.observeChildren("me").first().map { it.name })
    }

    @Test
    fun parentsChildrenAndSpousesAreQueryable() = runTest {
        person("father", "Father"); person("mother", "Mother")
        person("me", "Me"); person("wife", "Wife"); person("kid", "Kid")
        parentOf("father", "me")
        parentOf("mother", "me")
        parentOf("me", "kid")
        parentOf("wife", "kid")
        edges.insert(Relationship.of("me", "wife", RelationshipType.SPOUSE))

        assertEquals(setOf("Father", "Mother"), edges.observeParents("me").first().map { it.name }.toSet())
        assertEquals(listOf("Kid"), edges.observeChildren("me").first().map { it.name })
        assertEquals(listOf("Wife"), edges.observeSpouses("me").first().map { it.name })
        // Symmetric, so it reads the same from the other side.
        assertEquals(listOf("Me"), edges.observeSpouses("wife").first().map { it.name })
    }

    @Test
    fun siblingsAreDerivedFromSharedParents() = runTest {
        person("father"); person("mother")
        person("me", "Me"); person("sister", "Sister")
        listOf("me", "sister").forEach { parentOf("father", it); parentOf("mother", it) }

        assertEquals(listOf("Sister"), edges.observeSiblings("me").first().map { it.name })
        assertEquals(listOf("Me"), edges.observeSiblings("sister").first().map { it.name })
    }

    @Test
    fun aHalfSiblingSharingOneParentIsStillASibling() = runTest {
        person("father"); person("mother"); person("stepmother")
        person("me", "Me"); person("halfBrother", "Half brother")
        parentOf("father", "me"); parentOf("mother", "me")
        parentOf("father", "halfBrother"); parentOf("stepmother", "halfBrother")

        assertEquals(listOf("Half brother"), edges.observeSiblings("me").first().map { it.name })
    }

    @Test
    fun derivedSiblingsAreNotDuplicatedWhenBothParentsAreShared() = runTest {
        person("father"); person("mother"); person("me"); person("sister", "Sister")
        listOf("me", "sister").forEach { parentOf("father", it); parentOf("mother", it) }

        assertEquals(1, edges.observeSiblings("me").first().size)
    }

    @Test
    fun anExplicitSiblingEdgeCoversTheCaseWhereParentsAreUnknown() = runTest {
        person("me", "Me"); person("brother", "Brother")
        edges.insert(Relationship.of("me", "brother", RelationshipType.SIBLING))

        assertEquals(listOf("Brother"), edges.observeSiblings("me").first().map { it.name })
        assertEquals(listOf("Me"), edges.observeSiblings("brother").first().map { it.name })
    }

    @Test
    fun aSiblingKnownBothExplicitlyAndThroughParentsAppearsOnce() = runTest {
        person("father"); person("me", "Me"); person("brother", "Brother")
        parentOf("father", "me"); parentOf("father", "brother")
        edges.insert(Relationship.of("me", "brother", RelationshipType.SIBLING))

        assertEquals(listOf("Brother"), edges.observeSiblings("me").first().map { it.name })
    }

    @Test
    fun childrenAcrossDifferentSpousesAreAllChildren() = runTest {
        person("me", "Me"); person("first", "First wife"); person("second", "Second wife")
        person("childA", "A", ); person("childB", "B")
        edges.insert(Relationship.of("me", "first", RelationshipType.SPOUSE))
        edges.insert(Relationship.of("me", "second", RelationshipType.SPOUSE))
        parentOf("me", "childA"); parentOf("first", "childA")
        parentOf("me", "childB"); parentOf("second", "childB")

        assertEquals(setOf("A", "B"), edges.observeChildren("me").first().map { it.name }.toSet())
        assertEquals(setOf("First wife", "Second wife"), edges.observeSpouses("me").first().map { it.name }.toSet())
        // Half-siblings through the shared father.
        assertEquals(listOf("B"), edges.observeSiblings("childA").first().map { it.name })
    }

    @Test
    fun anUnrecognisedRelationshipTypeSurvivesAReadAsUnknown() = runTest {
        person("a"); person("b")
        db.openHelper.writableDatabase.execSQL(
            "INSERT INTO relationships (id, fromPersonId, toPersonId, type, subtype, createdAt) " +
                "VALUES ('r1', 'a', 'b', 'GODPARENT_FROM_THE_FUTURE', NULL, 0)"
        )

        // The row is kept rather than dropped; only its meaning is degraded.
        val stored = edges.findById("r1")!!
        assertEquals(RelationshipType.UNKNOWN, stored.type)
    }
}
