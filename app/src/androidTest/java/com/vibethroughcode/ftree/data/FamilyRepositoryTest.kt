package com.vibethroughcode.ftree.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vibethroughcode.ftree.graph.RelationshipRejection
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** The relationship operations as the user experiences them, over a real database. */
@RunWith(AndroidJUnit4::class)
class FamilyRepositoryTest {

    private lateinit var db: FTreeDatabase
    private lateinit var repository: FamilyRepository

    @Before
    fun setUp() {
        val context: Context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, FTreeDatabase::class.java)
            .addCallback(FTreeDatabase.enforceForeignKeys)
            .build()
        repository = FamilyRepository(db, PhotoStore(context))
    }

    @After
    fun tearDown() = db.close()

    private suspend fun person(id: String, name: String? = null): String {
        repository.addPerson(Person(id = id, name = name))
        return id
    }

    private fun Result<*>.rejection(): RelationshipRejection? =
        (exceptionOrNull() as? RelationshipRejectedException)?.reason

    @Test
    fun addingAParentIsReadableFromBothEnds() = runTest {
        person("me", "Me"); person("father", "Father")

        assertTrue(repository.addRelative("me", "father", RelativeKind.PARENT).isSuccess)

        assertEquals(listOf("Father"), repository.observeParents("me").first().map { it.name })
        assertEquals(listOf("Me"), repository.observeChildren("father").first().map { it.name })
    }

    @Test
    fun addingAChildIsTheSameEdgeSeenTheOtherWay() = runTest {
        person("me", "Me"); person("kid", "Kid")

        repository.addRelative("me", "kid", RelativeKind.CHILD)

        assertEquals(listOf("Kid"), repository.observeChildren("me").first().map { it.name })
        assertEquals(listOf("Me"), repository.observeParents("kid").first().map { it.name })
    }

    @Test
    fun aSpouseIsRecordedOnceAndReadsFromEitherSide() = runTest {
        person("me", "Me"); person("wife", "Wife")

        repository.addRelative("me", "wife", RelativeKind.SPOUSE)

        assertEquals(listOf("Wife"), repository.observeSpouses("me").first().map { it.name })
        assertEquals(listOf("Me"), repository.observeSpouses("wife").first().map { it.name })
        assertEquals(1, db.relationshipDao().allRelationships().size)
    }

    @Test
    fun aSiblingIsAttachedToTheParentsThatMakeThemOne() = runTest {
        person("father", "Father"); person("mother", "Mother")
        person("me", "Me"); person("brother", "Brother")
        repository.addRelative("me", "father", RelativeKind.PARENT)
        repository.addRelative("me", "mother", RelativeKind.PARENT)

        repository.addRelative("me", "brother", RelativeKind.SIBLING)

        // Not an explicit sibling edge — they share the parents, which is what makes them siblings
        // and what keeps the relationship true as more is recorded.
        assertEquals(
            setOf("Father", "Mother"),
            repository.observeParents("brother").first().map { it.name }.toSet(),
        )
        assertEquals(listOf("Brother"), repository.observeSiblings("me").first().map { it.name })
        assertTrue(db.relationshipDao().allRelationships().none { it.type == RelationshipType.SIBLING })
    }

    @Test
    fun aSiblingWithNoKnownParentsGetsAnExplicitEdge() = runTest {
        person("me", "Me"); person("brother", "Brother")

        repository.addRelative("me", "brother", RelativeKind.SIBLING)

        assertEquals(listOf("Brother"), repository.observeSiblings("me").first().map { it.name })
        assertEquals(
            listOf(RelationshipType.SIBLING),
            db.relationshipDao().allRelationships().map { it.type },
        )
    }

    @Test
    fun addingASiblingWhoAlreadySharesOneParentIsNotAnError() = runTest {
        person("father"); person("mother")
        person("me", "Me"); person("halfBrother", "Half brother")
        repository.addRelative("me", "father", RelativeKind.PARENT)
        repository.addRelative("me", "mother", RelativeKind.PARENT)
        repository.addRelative("halfBrother", "father", RelativeKind.PARENT)

        val result = repository.addRelative("me", "halfBrother", RelativeKind.SIBLING)

        assertTrue(result.isSuccess)
        assertEquals(2, repository.observeParents("halfBrother").first().size)
    }

    @Test
    fun nobodyCanBeTheirOwnRelative() = runTest {
        person("me")
        RelativeKind.entries.forEach { kind ->
            assertEquals(
                RelationshipRejection.SELF_REFERENCE,
                repository.addRelative("me", "me", kind).rejection(),
            )
        }
    }

    @Test
    fun theSameRelationshipCannotBeRecordedTwice() = runTest {
        person("me"); person("father")
        repository.addRelative("me", "father", RelativeKind.PARENT)

        assertEquals(
            RelationshipRejection.DUPLICATE,
            repository.addRelative("me", "father", RelativeKind.PARENT).rejection(),
        )
    }

    @Test
    fun aSpouseCannotBeAddedTwiceFromTheOtherSide() = runTest {
        person("me"); person("wife")
        repository.addRelative("me", "wife", RelativeKind.SPOUSE)

        assertEquals(
            RelationshipRejection.DUPLICATE,
            repository.addRelative("wife", "me", RelativeKind.SPOUSE).rejection(),
        )
    }

    @Test
    fun someoneCannotBecomeTheirOwnAncestor() = runTest {
        person("grandfather"); person("father"); person("me")
        repository.addRelative("father", "grandfather", RelativeKind.PARENT)
        repository.addRelative("me", "father", RelativeKind.PARENT)

        assertEquals(
            RelationshipRejection.ANCESTOR_CYCLE,
            repository.addRelative("grandfather", "me", RelativeKind.PARENT).rejection(),
        )
    }

    @Test
    fun aParentCannotAlsoBeMarkedAsASpouse() = runTest {
        person("father"); person("me")
        repository.addRelative("me", "father", RelativeKind.PARENT)

        assertEquals(
            RelationshipRejection.CONTRADICTS_EXISTING,
            repository.addRelative("me", "father", RelativeKind.SPOUSE).rejection(),
        )
    }

    @Test
    fun aFailedAddLeavesTheTreeExactlyAsItWas() = runTest {
        person("me", "Me"); person("father", "Father")
        repository.addRelative("me", "father", RelativeKind.PARENT)
        val peopleBefore = db.personDao().count()
        val edgesBefore = db.relationshipDao().allRelationships().size

        // A colliding id is a caller mistake; it must surface as a failed Result rather than
        // crashing or leaving the person written without their relationship.
        val result = repository.addNewRelative("me", Person(id = "father"), RelativeKind.PARENT)

        assertTrue(result.isFailure)
        assertEquals(peopleBefore, db.personDao().count())
        assertEquals(edgesBefore, db.relationshipDao().allRelationships().size)
    }

    @Test
    fun creatingAnUnknownRelativeRecordsARealPerson() = runTest {
        person("me", "Me")

        val result = repository.addNewRelative("me", Person(), RelativeKind.PARENT)

        assertTrue(result.isSuccess)
        val parents = repository.observeParents("me").first()
        assertEquals(1, parents.size)
        assertTrue(parents.single().isUnnamed)
    }

    @Test
    fun anUnknownRelativeCanBeNamedLaterWithoutTouchingTheRelationship() = runTest {
        person("me", "Me")
        val unknown = repository.addNewRelative("me", Person(), RelativeKind.PARENT).getOrThrow()

        repository.updatePerson(unknown.copy(name = "Raj Kumar"))

        assertEquals(listOf("Raj Kumar"), repository.observeParents("me").first().map { it.name })
    }

    @Test
    fun removingARelationshipKeepsBothPeople() = runTest {
        person("me", "Me"); person("father", "Father")
        repository.addRelative("me", "father", RelativeKind.PARENT)

        repository.edgesBetween("me", "father").forEach { repository.removeRelationship(it.id) }

        assertEquals(emptyList<Person>(), repository.observeParents("me").first())
        assertEquals(2, db.personDao().count())
    }

    @Test
    fun childrenAcrossTwoMarriagesAreHalfSiblings() = runTest {
        person("me", "Me"); person("first", "First"); person("second", "Second")
        person("a", "A"); person("b", "B")
        repository.addRelative("me", "first", RelativeKind.SPOUSE)
        repository.addRelative("me", "second", RelativeKind.SPOUSE)
        repository.addRelative("me", "a", RelativeKind.CHILD)
        repository.addRelative("first", "a", RelativeKind.CHILD)
        repository.addRelative("me", "b", RelativeKind.CHILD)
        repository.addRelative("second", "b", RelativeKind.CHILD)

        assertEquals(setOf("A", "B"), repository.observeChildren("me").first().map { it.name }.toSet())
        assertEquals(listOf("B"), repository.observeSiblings("a").first().map { it.name })
        assertEquals(2, repository.observeSpouses("me").first().size)
    }
}
