package com.vibethroughcode.ftree.debug

import com.vibethroughcode.ftree.data.FTreeDatabase
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind

/**
 * Sample trees for development.
 *
 * [family] is deliberately awkward rather than tidy: it has unknown ancestors, two marriages,
 * half-siblings and a person with no dates, because those are the cases the layout and the merge
 * logic have to survive and a clean nuclear family would prove nothing.
 */
class SampleData(
    private val repository: FamilyRepository,
    private val database: FTreeDatabase,
) {

    suspend fun clear() = database.clearAllTables()

    suspend fun family() {
        clear()

        suspend fun add(
            name: String?,
            gender: Gender = Gender.UNSPECIFIED,
            born: String? = null,
            died: String? = null,
        ): String {
            val person = Person(
                name = name,
                gender = gender,
                birthDate = born,
                deathDate = died,
                deceased = died != null,
            )
            repository.addPerson(person)
            return person.id
        }

        // Generation 1 — the edge of what is remembered.
        val greatGrandfather = add("Shyam Lal", Gender.MALE, "1905", "1978")
        val greatGrandmother = add(null, Gender.FEMALE)

        // Generation 2
        val grandfather = add("Raj Kumar", Gender.MALE, "1938", "2010")
        val grandmother = add("Sushila Devi", Gender.FEMALE, "1942")
        val greatUncle = add(null, Gender.MALE)

        // Generation 3
        val father = add("Vinod Kumar", Gender.MALE, "1962")
        val mother = add("Anita Kumar", Gender.FEMALE, "1965")
        val aunt = add("Meena", Gender.FEMALE, "1968")

        // Generation 4
        val me = add("Ankit Kumar", Gender.MALE, "1990-05-01")
        val sister = add("Neha Kumar", Gender.FEMALE, "1993")
        val wife = add("Priya Sharma", Gender.FEMALE, "1992")
        val cousin = add("Rohit", Gender.MALE, "1995")

        // Generation 5
        val child = add("Aarav Kumar", Gender.MALE, "2020")

        listOf(greatGrandfather, greatGrandmother).forEach {
            repository.addRelative(grandfather, it, RelativeKind.PARENT)
            repository.addRelative(greatUncle, it, RelativeKind.PARENT)
        }
        repository.addRelative(greatGrandfather, greatGrandmother, RelativeKind.SPOUSE)

        repository.addRelative(grandfather, grandmother, RelativeKind.SPOUSE)
        listOf(father, aunt).forEach {
            repository.addRelative(it, grandfather, RelativeKind.PARENT)
            repository.addRelative(it, grandmother, RelativeKind.PARENT)
        }

        repository.addRelative(father, mother, RelativeKind.SPOUSE)
        listOf(me, sister).forEach {
            repository.addRelative(it, father, RelativeKind.PARENT)
            repository.addRelative(it, mother, RelativeKind.PARENT)
        }

        repository.addRelative(aunt, cousin, RelativeKind.CHILD)

        repository.addRelative(me, wife, RelativeKind.SPOUSE)
        repository.addRelative(me, child, RelativeKind.CHILD)
        repository.addRelative(wife, child, RelativeKind.CHILD)
    }

    /**
     * A wide, deep tree for performance work: each generation has several children, so the person
     * count grows quickly without the graph becoming unrealistic.
     */
    suspend fun large(size: Int) {
        clear()
        var created = 0
        var generation = listOf(newPerson("Ancestor", 1900).also { created++ })
        var year = 1900

        while (created < size) {
            year += 28
            val next = mutableListOf<String>()
            for (parent in generation) {
                if (created >= size) break
                val partner = newPerson(null, year - 26).also { created++ }
                repository.addRelative(parent, partner, RelativeKind.SPOUSE)
                repeat(3) {
                    if (created >= size) return@repeat
                    val child = newPerson("Person $created", year).also { created++ }
                    repository.addRelative(child, parent, RelativeKind.PARENT)
                    repository.addRelative(child, partner, RelativeKind.PARENT)
                    next += child
                }
            }
            if (next.isEmpty()) break
            generation = next
        }
    }

    private suspend fun newPerson(name: String?, born: Int): String {
        val person = Person(
            name = name,
            gender = if (born % 2 == 0) Gender.MALE else Gender.FEMALE,
            birthDate = born.toString(),
        )
        repository.addPerson(person)
        return person.id
    }
}
