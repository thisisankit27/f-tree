package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.transfer.TreeDocument
import kotlinx.serialization.json.Json
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.zip.ZipInputStream

/**
 * Every member related to every other, in Hindi.
 *
 * A vocabulary this size cannot be checked by reading it. Forty-five hand-written cases prove the
 * rules on the shapes somebody thought of; this proves them on every shape a real family contains,
 * by asking a question the code cannot answer twice the same way by accident:
 *
 * **if B is A's मामा, then A must be B's भांजा or भांजी.**
 *
 * The two answers are computed independently, from opposite ends of the graph, through different
 * branches of the rules. A mistake in "which side of the family" or "who links them" makes them
 * disagree, and there is no way to satisfy the whole table by luck. Cousins are the sharpest test
 * of all: a फुफेरा भाई must see you as his ममेरा भाई, never as another फुफेरा — the relationship
 * inverts as it crosses.
 *
 * Runs on a built-in family in CI, and on a real exported tree when one is named:
 *
 *     ./gradlew testDebugUnitTest -Dftree.tree=temp/family-tree.ftree
 */
class HindiEveryPairTest {

    /** If B is A's key, A must be one of the values from B. */
    private val reciprocal: Map<HindiKinTerm, Set<HindiKinTerm>> = buildMap {
        fun pair(a: Set<HindiKinTerm>, b: Set<HindiKinTerm>) {
            a.forEach { put(it, b) }
            b.forEach { put(it, a) }
        }
        val parents = setOf(HindiKinTerm.PITA, HindiKinTerm.MATA)
        val children = setOf(HindiKinTerm.BETA, HindiKinTerm.BETI)
        val siblings = setOf(HindiKinTerm.BHAI, HindiKinTerm.BEHEN)
        val fathersSiblings = setOf(
            HindiKinTerm.TAU, HindiKinTerm.CHACHA, HindiKinTerm.FATHERS_BROTHER, HindiKinTerm.BUA,
        )
        val mothersSiblings = setOf(HindiKinTerm.MAMA, HindiKinTerm.MAUSI)
        val brothersChildren = setOf(HindiKinTerm.BHATIJA, HindiKinTerm.BHATIJI)
        val sistersChildren = setOf(HindiKinTerm.BHANJA, HindiKinTerm.BHANJI)

        pair(parents, children)
        pair(siblings, siblings)
        pair(setOf(HindiKinTerm.DADA, HindiKinTerm.DADI), setOf(HindiKinTerm.POTA, HindiKinTerm.POTI))
        pair(setOf(HindiKinTerm.NANA, HindiKinTerm.NANI), setOf(HindiKinTerm.NATI, HindiKinTerm.NATIN))
        // A father's sibling sees you as their brother's child; a mother's, as their sister's.
        pair(fathersSiblings, brothersChildren)
        pair(mothersSiblings, sistersChildren)
        // Cousins invert as they cross: your father's sister's son is, to him, your mother's
        // brother's son. The two that come through a same-sex sibling stay themselves.
        pair(
            setOf(HindiKinTerm.PHUPHERA_BHAI, HindiKinTerm.PHUPHERI_BEHEN),
            setOf(HindiKinTerm.MAMERA_BHAI, HindiKinTerm.MAMERI_BEHEN),
        )
        pair(
            setOf(HindiKinTerm.CHACHERA_BHAI, HindiKinTerm.CHACHERI_BEHEN),
            setOf(HindiKinTerm.CHACHERA_BHAI, HindiKinTerm.CHACHERI_BEHEN),
        )
        pair(
            setOf(HindiKinTerm.MAUSERA_BHAI, HindiKinTerm.MAUSERI_BEHEN),
            setOf(HindiKinTerm.MAUSERA_BHAI, HindiKinTerm.MAUSERI_BEHEN),
        )
        // Through marriage.
        pair(setOf(HindiKinTerm.PATI), setOf(HindiKinTerm.PATNI))
        pair(
            setOf(HindiKinTerm.SASUR, HindiKinTerm.SAAS),
            setOf(HindiKinTerm.DAMAD, HindiKinTerm.BAHU),
        )
        pair(setOf(HindiKinTerm.JIJA), setOf(HindiKinTerm.SALA, HindiKinTerm.SALI))
        pair(
            setOf(HindiKinTerm.BHABHI),
            setOf(
                HindiKinTerm.JETH, HindiKinTerm.DEVAR, HindiKinTerm.HUSBANDS_BROTHER,
                HindiKinTerm.NANAD,
            ),
        )
    }

    /**
     * Whether Hindi has a word for this *shape* of relationship at all.
     *
     * English names every blood relation however far out — "second cousin twice removed" — by
     * building a phrase out of two numbers. Hindi does not work that way: it has a precise word for
     * each of the relationships a family talks about and nothing beyond them, which is why a raw
     * percentage over every pair in a six-generation tree says more about the tree's depth than about
     * the vocabulary. This is the honest denominator.
     */
    private fun hindiCovers(term: KinshipTerm): Boolean = when (term) {
        KinshipTerm.Self, KinshipTerm.Sibling, KinshipTerm.Spouse -> true
        is KinshipTerm.Ancestor -> term.generations <= 3
        is KinshipTerm.Descendant -> term.generations <= 3
        is KinshipTerm.ParentsSibling -> term.greats == 0
        is KinshipTerm.SiblingsChild -> term.greats == 0
        is KinshipTerm.Cousin -> term.degree == 1 && term.removed == 0
        is KinshipTerm.SpouseOf -> when (val r = term.relative) {
            KinshipTerm.Sibling -> true
            is KinshipTerm.ParentsSibling -> r.greats == 0
            is KinshipTerm.Ancestor -> r.generations == 1
            is KinshipTerm.Descendant -> r.generations == 1
            else -> false
        }
        is KinshipTerm.OfSpouse -> when (val r = term.relative) {
            KinshipTerm.Sibling -> true
            is KinshipTerm.Ancestor -> r.generations == 1
            is KinshipTerm.Descendant -> r.generations == 1
            else -> false
        }
    }

    private fun hindiOf(snapshot: FamilySnapshot, from: String, to: String): HindiKinTerm? {
        val found = Kinship.relate(snapshot, from, to) as? Relation.Found ?: return null
        val term = found.term ?: return null
        return HindiKinship.term(
            term = term,
            path = found.path,
            subject = snapshot.people.getValue(from).gender,
            target = snapshot.people.getValue(to).gender,
        )
    }

    private data class Report(
        val pairs: Int,
        /** Pairs English can name with a structured term at all. */
        val related: Int,
        /** …of those, the ones whose shape Hindi has a word for when the record is complete. */
        val coverable: Int,
        val named: Int,
        val descriptive: Int,
        /** Named one way but not the other, because somebody on the line has no recorded gender. */
        val excusedByGender: Int,
        /** …or because the line runs through a marriage the record has recorded inconsistently. */
        val excusedByContradiction: Int,
        val contradictions: List<String>,
        val breaches: List<String>,
        val counts: Map<HindiKinTerm, Int>,
    )

    /**
     * Whether an unrecorded gender explains why no word came back.
     *
     * Hindi has no gender-neutral kinship word — there is no neuter for भाई or बहन — so a person
     * whose gender nobody wrote down genuinely has no term, and saying nothing is the right answer.
     * That is a fact about the record rather than a fault in the rules, and this is what separates
     * the two so the test can still fail on the second.
     */
    private fun genderIsMissing(snapshot: FamilySnapshot, from: String, to: String): Boolean {
        val found = Kinship.relate(snapshot, from, to) as? Relation.Found ?: return false
        val involved = found.peopleInvolved(from)
        return involved.any { snapshot.people[it]?.gender != Gender.MALE &&
            snapshot.people[it]?.gender != Gender.FEMALE }
    }

    /**
     * Marriages the record states inconsistently — both partners written down with the same gender.
     *
     * Almost always one gender entered wrongly rather than anything about the marriage. Every Hindi
     * in-law word names both partners (जीजा married a sister, भाभी married a brother), so a line
     * running through such a marriage genuinely has no word, and the rules are right to decline. The
     * test separates these from real disagreements so a mistake in somebody's tree cannot be mistaken
     * for a mistake in the vocabulary — and names them, because they are worth fixing.
     */
    private fun contradictoryMarriages(snapshot: FamilySnapshot): Set<Set<String>> =
        snapshot.spouseEdges.filter { (a, b) ->
            val one = snapshot.people[a]?.gender
            val two = snapshot.people[b]?.gender
            one != null && one == two && one != Gender.UNSPECIFIED && one != Gender.OTHER
        }.map { setOf(it.first, it.second) }.toSet()

    /** Whether the line joining two people passes through one of those marriages. */
    private fun crossesContradiction(
        snapshot: FamilySnapshot,
        from: String,
        to: String,
        bad: Set<Set<String>>,
    ): Boolean {
        if (bad.isEmpty()) return false
        val found = Kinship.relate(snapshot, from, to) as? Relation.Found ?: return false
        var previous = from
        return found.chain.any { step ->
            val crosses = step.kind == StepKind.SPOUSE && setOf(previous, step.personId) in bad
            previous = step.personId
            crosses
        }
    }

    private fun sweep(snapshot: FamilySnapshot): Report {
        val ids = snapshot.people.keys.toList()
        var pairs = 0
        var related = 0
        var coverable = 0
        var named = 0
        var descriptive = 0
        var excused = 0
        var contradicted = 0
        val breaches = mutableListOf<String>()
        val counts = mutableMapOf<HindiKinTerm, Int>()
        val bad = contradictoryMarriages(snapshot)

        fun name(id: String) = snapshot.people[id]?.name ?: id

        ids.forEach { a ->
            ids.forEach inner@{ b ->
                if (a == b) return@inner
                pairs++
                (Kinship.relate(snapshot, a, b) as? Relation.Found)?.term?.let {
                    related++
                    if (hindiCovers(it)) coverable++
                }

                val forward = hindiOf(snapshot, a, b) ?: return@inner
                named++
                if (forward.needsBirthYears) descriptive++
                counts[forward] = (counts[forward] ?: 0) + 1

                val expected = reciprocal[forward] ?: return@inner
                val back = hindiOf(snapshot, b, a)
                when {
                    back == null && genderIsMissing(snapshot, b, a) -> excused++
                    crossesContradiction(snapshot, a, b, bad) ||
                        crossesContradiction(snapshot, b, a, bad) -> contradicted++
                    back == null -> breaches +=
                        "${name(b)} is ${name(a)}'s $forward, and nothing comes back the other way " +
                            "— yet every gender on that line is recorded"
                    back !in expected -> breaches +=
                        "${name(b)} is ${name(a)}'s $forward, so ${name(a)} should be one of " +
                            "$expected to ${name(b)} — got $back"
                }
            }
        }
        return Report(
            pairs = pairs,
            related = related,
            coverable = coverable,
            named = named,
            descriptive = descriptive,
            excusedByGender = excused,
            excusedByContradiction = contradicted,
            contradictions = bad.map { it.joinToString(" and ") { id -> name(id) } },
            breaches = breaches,
            counts = counts,
        )
    }

    /**
     * The built-in family: four generations, both sides recorded, every kind of aunt and uncle with
     * children of their own, and marriages at both ends.
     */
    private fun family(): FamilySnapshot {
        val people = mutableMapOf<String, Person>()
        val parents = mutableListOf<Pair<String, String>>()
        val spouses = mutableListOf<Pair<String, String>>()

        fun add(id: String, gender: Gender, born: String) {
            people[id] = Person(id = id, name = id, gender = gender, birthDate = born)
        }
        fun kids(a: String, b: String, vararg children: String) {
            children.forEach { parents += a to it; parents += b to it }
        }

        add("dada", Gender.MALE, "1930"); add("dadi", Gender.FEMALE, "1934")
        add("nana", Gender.MALE, "1932"); add("nani", Gender.FEMALE, "1936")
        add("tau", Gender.MALE, "1952"); add("tai", Gender.FEMALE, "1955")
        add("dad", Gender.MALE, "1958"); add("mum", Gender.FEMALE, "1960")
        add("chacha", Gender.MALE, "1963"); add("chachi", Gender.FEMALE, "1966")
        add("bua", Gender.FEMALE, "1955"); add("phupha", Gender.MALE, "1952")
        add("mama", Gender.MALE, "1956"); add("mami", Gender.FEMALE, "1959")
        add("mausi", Gender.FEMALE, "1962"); add("mausa", Gender.MALE, "1960")
        add("me", Gender.MALE, "1985"); add("wife", Gender.FEMALE, "1987")
        add("brother", Gender.MALE, "1988"); add("bhabhi", Gender.FEMALE, "1989")
        add("sister", Gender.FEMALE, "1990"); add("jija", Gender.MALE, "1986")
        add("son", Gender.MALE, "2012"); add("daughter", Gender.FEMALE, "2015")
        add("sasur", Gender.MALE, "1958"); add("saas", Gender.FEMALE, "1961")
        add("sala", Gender.MALE, "1990"); add("sali", Gender.FEMALE, "1992")
        listOf(
            "tau-son" to Gender.MALE, "tau-daughter" to Gender.FEMALE,
            "chacha-son" to Gender.MALE, "chacha-daughter" to Gender.FEMALE,
            "bua-son" to Gender.MALE, "bua-daughter" to Gender.FEMALE,
            "mama-son" to Gender.MALE, "mama-daughter" to Gender.FEMALE,
            "mausi-son" to Gender.MALE, "mausi-daughter" to Gender.FEMALE,
            "brother-son" to Gender.MALE, "sister-daughter" to Gender.FEMALE,
        ).forEach { (id, g) -> add(id, g, "1990") }

        spouses += listOf(
            "dada" to "dadi", "nana" to "nani", "tau" to "tai", "dad" to "mum",
            "chacha" to "chachi", "bua" to "phupha", "mama" to "mami", "mausi" to "mausa",
            "me" to "wife", "brother" to "bhabhi", "sister" to "jija", "sasur" to "saas",
        )
        kids("dada", "dadi", "tau", "dad", "chacha", "bua")
        kids("nana", "nani", "mum", "mama", "mausi")
        kids("dad", "mum", "me", "brother", "sister")
        kids("me", "wife", "son", "daughter")
        kids("sasur", "saas", "wife", "sala", "sali")
        kids("tau", "tai", "tau-son", "tau-daughter")
        kids("chacha", "chachi", "chacha-son", "chacha-daughter")
        kids("bua", "phupha", "bua-son", "bua-daughter")
        kids("mama", "mami", "mama-son", "mama-daughter")
        kids("mausi", "mausa", "mausi-son", "mausi-daughter")
        kids("brother", "bhabhi", "brother-son")
        kids("sister", "jija", "sister-daughter")

        return FamilySnapshot(people, parents, spouses, emptyList())
    }

    @Test
    fun everyPairAgreesWithItsOppositeNumber() {
        val report = sweep(family())
        println(summary("built-in family", report))
        report.counts.entries.sortedByDescending { it.value }
            .forEach { println("  ${it.key}: ${it.value}") }

        if (report.breaches.isNotEmpty()) {
            throw AssertionError(
                "${report.breaches.size} relationships disagree with their reverse:\n" +
                    report.breaches.take(25).joinToString("\n")
            )
        }
    }

    /** The same sweep over a real exported tree, when one is named on the command line. */
    @Test
    fun everyPairOfARealTreeAgreesToo() {
        val path = System.getProperty("ftree.tree")
        assumeTrue("no -Dftree.tree given", path != null)

        val snapshot = load(File(path))
        val report = sweep(snapshot)
        println(summary("real tree, ${snapshot.people.size} people", report))
        report.counts.entries.sortedByDescending { it.value }
            .forEach { println("  ${it.key}: ${it.value}") }

        if (report.breaches.isNotEmpty()) {
            throw AssertionError(
                "${report.breaches.size} relationships disagree with their reverse:\n" +
                    report.breaches.take(25).joinToString("\n")
            )
        }
    }

    private fun summary(label: String, r: Report) = buildString {
        appendLine("$label — ${r.pairs} ordered pairs")
        appendLine("  ${r.related} have a relationship English can name at all")
        appendLine("  ${r.coverable} of those are a shape Hindi has a word for")
        appendLine("  ${r.named} get a Hindi word — ${r.named * 100 / maxOf(r.coverable, 1)}% of the")
        appendLine("     shapes it covers, ${r.named * 100 / maxOf(r.related, 1)}% of every named pair")
        appendLine("  ${r.descriptive} of those are descriptive, for want of a birth year")
        appendLine("  ${r.excusedByGender} have no word coming back, because a gender is unrecorded")
        if (r.contradictions.isNotEmpty()) {
            appendLine(
                "  ${r.excusedByContradiction} run through a marriage recorded inconsistently:"
            )
            r.contradictions.forEach { appendLine("     $it — both recorded with the same gender") }
        }
    }

    private fun load(file: File): FamilySnapshot {
        val json = ZipInputStream(file.inputStream()).use { zip ->
            generateSequence { zip.nextEntry }
                .firstOrNull { it.name == TreeDocument.ENTRY_JSON }
                ?: error("no ${TreeDocument.ENTRY_JSON} in ${file.name}")
            zip.readBytes().decodeToString()
        }
        val doc = Json { ignoreUnknownKeys = true }.decodeFromString<TreeDocument>(json)
        val people = doc.people.associate { record ->
            record.id to Person(
                id = record.id,
                name = record.name,
                gender = Gender.entries.firstOrNull { it.name == record.gender }
                    ?: Gender.UNSPECIFIED,
                birthDate = record.birthDate,
                deathDate = record.deathDate,
                deceased = record.deceased,
            )
        }
        val parents = mutableListOf<Pair<String, String>>()
        val spouses = mutableListOf<Pair<String, String>>()
        val siblings = mutableListOf<Pair<String, String>>()
        doc.relationships.forEach {
            when (it.type) {
                "PARENT" -> parents += it.from to it.to
                "SPOUSE" -> spouses += it.from to it.to
                "SIBLING" -> siblings += it.from to it.to
            }
        }
        return FamilySnapshot(people, parents, spouses, siblings)
    }
}
