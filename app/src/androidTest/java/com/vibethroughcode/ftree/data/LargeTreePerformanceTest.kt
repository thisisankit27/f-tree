package com.vibethroughcode.ftree.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vibethroughcode.ftree.graph.TreeLayoutEngine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.system.measureTimeMillis

/**
 * Guards the property the chart's design depends on: **the cost of looking at one person does not
 * grow with the size of the family.**
 *
 * The thresholds are deliberately loose. This runs on an emulator with software rendering, so the
 * absolute numbers mean little; what matters is that they are bounded, and that a change which
 * accidentally starts loading the whole graph would blow straight through them.
 */
@RunWith(AndroidJUnit4::class)
class LargeTreePerformanceTest {

    private lateinit var db: FTreeDatabase
    private lateinit var repository: FamilyRepository

    private val size = 2_000

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

    /** A wide, deep family: every couple has three children, generation after generation. */
    private suspend fun seed(): String {
        val people = mutableListOf<Person>()
        val edges = mutableListOf<Relationship>()

        val root = Person(name = "Ancestor", birthDate = "1900")
        people += root
        var generation = listOf(root.id)
        var year = 1900

        while (people.size < size) {
            year += 28
            val next = mutableListOf<String>()
            for (parent in generation) {
                if (people.size >= size) break
                val partner = Person(name = "Partner ${people.size}", birthDate = (year - 26).toString())
                people += partner
                edges += Relationship.of(parent, partner.id, RelationshipType.SPOUSE)
                repeat(3) {
                    if (people.size >= size) return@repeat
                    val child = Person(name = "Person ${people.size}", birthDate = year.toString())
                    people += child
                    edges += Relationship.of(parent, child.id, RelationshipType.PARENT)
                    edges += Relationship.of(partner.id, child.id, RelationshipType.PARENT)
                    next += child.id
                }
            }
            if (next.isEmpty()) break
            generation = next
        }

        db.personDao().insertAll(people)
        db.relationshipDao().insertIgnoringDuplicates(edges)
        return people[people.size / 2].id
    }

    @Test
    fun openingTheChartOnOnePersonDoesNotDependOnTheSizeOfTheFamily() = runTest {
        val someoneInTheMiddle = seed()
        assertEquals(size, db.personDao().count())

        // Warm the connection so the first query's setup is not attributed to the work.
        repository.loadNeighbourhood(someoneInTheMiddle, 3, 3)

        val elapsed = measureTimeMillis {
            val snapshot = repository.loadNeighbourhood(someoneInTheMiddle, 3, 3)
            val layout = TreeLayoutEngine.layout(snapshot, someoneInTheMiddle)
            assertTrue("expected a drawn chart", layout.nodes.isNotEmpty())
            // Only the neighbourhood, never the whole family.
            assertTrue(
                "loaded ${snapshot.people.size} of $size people",
                snapshot.people.size < size / 4,
            )
        }

        assertTrue("loading and laying out took ${elapsed}ms", elapsed < 1_500)
    }

    @Test
    fun oneQuestionAboutOnePersonStaysFastInALargeFamily() = runTest {
        val someoneInTheMiddle = seed()

        val elapsed = measureTimeMillis {
            repeat(20) {
                repository.observeParents(someoneInTheMiddle).first()
                repository.observeChildren(someoneInTheMiddle).first()
                repository.observeSiblings(someoneInTheMiddle).first()
                repository.observeSpouses(someoneInTheMiddle).first()
            }
        }

        assertTrue("80 relative queries took ${elapsed}ms", elapsed < 3_000)
    }

    @Test
    fun theWholeFamilyCanStillBeExportedAndCounted() = runTest {
        seed()

        val elapsed = measureTimeMillis {
            assertEquals(size, repository.allPeople().size)
            assertTrue(repository.allRelationships().isNotEmpty())
        }

        assertTrue("whole-tree read took ${elapsed}ms", elapsed < 3_000)
    }
}
