package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.Person
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Hindi vocabulary, pinned relationship by relationship.
 *
 * This is the file that decides whether the feature is right. English collapses five Hindi words
 * into "uncle", so every one of these could be quietly wrong in a way no English test would catch —
 * and a Hindi speaker reading "चाचा" for their mother's brother sees the mistake instantly, where
 * "uncle" was merely vague. Each case names the family shape it comes from so the table can be
 * checked against how a family actually speaks rather than against the code.
 *
 * The tree below is built to reach every term at once: both grandfathers, all four kinds of
 * parent's sibling with their spouses, both kinds of cousin-through-a-brother and through a sister,
 * nieces and nephews on both sides, and a marriage on each end.
 */
class HindiKinshipTest {

    private class Builder {
        val people = mutableMapOf<String, Person>()
        val parents = mutableListOf<Pair<String, String>>()
        val spouses = mutableListOf<Pair<String, String>>()
        val siblings = mutableListOf<Pair<String, String>>()

        fun man(id: String, born: String? = null) = person(id, Gender.MALE, born)
        fun woman(id: String, born: String? = null) = person(id, Gender.FEMALE, born)

        fun person(id: String, gender: Gender, born: String? = null) = apply {
            people[id] = Person(id = id, name = id, gender = gender, birthDate = born)
        }

        fun childrenOf(a: String, b: String, vararg children: String) = apply {
            children.forEach { parents += a to it; parents += b to it }
        }

        fun married(a: String, b: String) = apply { spouses += a to b }
        fun build() = FamilySnapshot(people, parents, spouses, siblings)
    }

    /**
     * "me" at the centre, with both sides of the family recorded and birth years where the order
     * matters — the father's brothers, because ताऊ and चाचा are told apart by nothing else.
     */
    private fun family() = Builder()
        // Father's parents, and his siblings: an elder brother, a younger brother, a sister.
        .man("dada", "1930").woman("dadi", "1934")
        .man("tau", "1952").woman("tau-wife", "1955")
        .man("dad", "1958").woman("mum", "1960")
        .man("chacha", "1963").woman("chacha-wife", "1966")
        .woman("bua", "1955").man("bua-husband", "1952")
        // Mother's parents, and her siblings: a brother and a sister.
        .man("nana", "1932").woman("nani", "1936")
        .man("mama", "1956").woman("mama-wife", "1959")
        .woman("mausi", "1962").man("mausi-husband", "1960")
        // Me, my wife, my brother and sister, my children.
        .man("me", "1985").woman("wife", "1987")
        .man("brother", "1988").woman("sister", "1990")
        .man("son", "2012").woman("daughter", "2015")
        .man("grandson", "2040").woman("granddaughter", "2042")
        // The cousins, one set from each aunt and uncle.
        .man("chachera", "1990").woman("chacheri", "1992")
        .man("phuphera", "1988").woman("phupheri", "1991")
        .man("mamera", "1989").woman("mameri", "1993")
        .man("mausera", "1994").woman("mauseri", "1996")
        // Nieces and nephews, through my brother and through my sister.
        .man("bhatija", "2014").woman("bhatiji", "2016")
        .man("bhanja", "2018").woman("bhanji", "2020")
        // My wife's family, for the in-law terms.
        .man("sasur", "1958").woman("saas", "1961")
        .man("sala", "1990").woman("sali", "1992")
        // Spouses of my own siblings.
        .man("jija", "1986").woman("bhabhi", "1989")

        .married("dada", "dadi").married("nana", "nani")
        .married("dad", "mum").married("me", "wife")
        .married("tau", "tau-wife").married("chacha", "chacha-wife")
        .married("bua", "bua-husband").married("mama", "mama-wife")
        .married("mausi", "mausi-husband")
        .married("sasur", "saas")
        .married("sister", "jija").married("brother", "bhabhi")

        .childrenOf("dada", "dadi", "tau", "dad", "chacha", "bua")
        .childrenOf("nana", "nani", "mum", "mama", "mausi")
        .childrenOf("dad", "mum", "me", "brother", "sister")
        .childrenOf("me", "wife", "son", "daughter")
        .childrenOf("son", "daughter-in-law-unused", "grandson")
        .childrenOf("chacha", "chacha-wife", "chachera", "chacheri")
        .childrenOf("bua", "bua-husband", "phuphera", "phupheri")
        .childrenOf("mama", "mama-wife", "mamera", "mameri")
        .childrenOf("mausi", "mausi-husband", "mausera", "mauseri")
        .childrenOf("brother", "bhabhi", "bhatija", "bhatiji")
        .childrenOf("sister", "jija", "bhanja", "bhanji")
        .childrenOf("sasur", "saas", "wife", "sala", "sali")
        .build()

    /** The word for [other] as seen from [subject]. */
    private fun word(
        snapshot: FamilySnapshot,
        subject: String,
        other: String,
    ): HindiKinTerm? {
        val relation = Kinship.relate(snapshot, subject, other) as? Relation.Found
            ?: error("$subject and $other are not related in the fixture")
        val term = relation.term ?: return null
        return HindiKinship.term(
            term = term,
            path = relation.path,
            subject = snapshot.people.getValue(subject).gender,
            target = snapshot.people.getValue(other).gender,
        )
    }

    private fun assertWord(expected: HindiKinTerm, other: String, subject: String = "me") {
        assertEquals("$other, seen from $subject", expected, word(family(), subject, other))
    }

    /* --------------------------------------------------------------------------- the sides */

    /**
     * The distinction the whole feature exists for. English says "grandfather" twice; Hindi says
     * दादा for the father's father and नाना for the mother's, and they are not interchangeable.
     */
    @Test
    fun theTwoGrandfathersHaveDifferentWords() {
        assertWord(HindiKinTerm.DADA, "dada")
        assertWord(HindiKinTerm.DADI, "dadi")
        assertWord(HindiKinTerm.NANA, "nana")
        assertWord(HindiKinTerm.NANI, "nani")
    }

    /** The reported case: Ankit's mother's brother is his मामा, never his चाचा. */
    @Test
    fun mothersBrotherIsMamaAndFathersBrotherIsNot() {
        assertWord(HindiKinTerm.MAMA, "mama")
        assertWord(HindiKinTerm.CHACHA, "chacha")
    }

    @Test
    fun allFourKindsOfParentsSiblingAreDistinguished() {
        assertWord(HindiKinTerm.TAU, "tau")          // father's elder brother
        assertWord(HindiKinTerm.CHACHA, "chacha")    // father's younger brother
        assertWord(HindiKinTerm.BUA, "bua")          // father's sister
        assertWord(HindiKinTerm.MAMA, "mama")        // mother's brother
        assertWord(HindiKinTerm.MAUSI, "mausi")      // mother's sister
    }

    @Test
    fun theirSpousesTakeTheWordThatBelongsToThem() {
        assertWord(HindiKinTerm.TAI, "tau-wife")
        assertWord(HindiKinTerm.CHACHI, "chacha-wife")
        assertWord(HindiKinTerm.PHUPHA, "bua-husband")
        assertWord(HindiKinTerm.MAMI, "mama-wife")
        assertWord(HindiKinTerm.MAUSA, "mausi-husband")
    }

    /* ------------------------------------------------------------------------ birth order */

    /**
     * ताऊ is the elder brother and चाचा the younger, and nothing but a date says which. With the
     * years removed the app says "father's brother" rather than picking one — the same rule that
     * removed "related by marriage": claim precision only where the record supports it.
     */
    @Test
    fun withoutBirthYearsFathersBrotherIsNamedDescriptively() {
        val undated = Builder()
            .man("dada").woman("dadi")
            .man("dad").woman("mum")
            .man("uncle").woman("uncle-wife")
            .man("me")
            .married("dad", "mum").married("uncle", "uncle-wife")
            .childrenOf("dada", "dadi", "dad", "uncle")
            .childrenOf("dad", "mum", "me")
            .build()

        assertEquals(HindiKinTerm.FATHERS_BROTHER, word(undated, "me", "uncle"))
        assertEquals(HindiKinTerm.FATHERS_BROTHERS_WIFE, word(undated, "me", "uncle-wife"))
    }

    /** And the descriptive terms say so, which is how the screen knows to offer the nudge. */
    @Test
    fun theDescriptiveTermsAskForBirthYears() {
        assertTrue(HindiKinTerm.FATHERS_BROTHER.needsBirthYears)
        assertTrue(HindiKinTerm.FATHERS_BROTHERS_WIFE.needsBirthYears)
        assertTrue(HindiKinTerm.HUSBANDS_BROTHER.needsBirthYears)
        assertEquals(
            "no other term should be claiming it needs a birth year",
            3,
            HindiKinTerm.entries.count { it.needsBirthYears },
        )
    }

    /** Years that overlap prove nothing. "1958" and "1958" could be either way round. */
    @Test
    fun yearsThatCouldOverlapDoNotSettleTheOrder() {
        val ambiguous = Builder()
            .man("dada").woman("dadi")
            .man("dad", "1958").man("uncle", "1958")
            .woman("mum").man("me")
            .married("dad", "mum")
            .childrenOf("dada", "dadi", "dad", "uncle")
            .childrenOf("dad", "mum", "me")
            .build()

        assertEquals(HindiKinTerm.FATHERS_BROTHER, word(ambiguous, "me", "uncle"))
    }

    /** Only the father's brothers ever need a date. मामा and मौसी never do. */
    @Test
    fun theOtherSidesNeverNeedABirthYear() {
        val undated = Builder()
            .man("nana").woman("nani")
            .man("dad").woman("mum")
            .man("mama").woman("mausi")
            .man("me")
            .married("dad", "mum")
            .childrenOf("nana", "nani", "mum", "mama", "mausi")
            .childrenOf("dad", "mum", "me")
            .build()

        assertEquals(HindiKinTerm.MAMA, word(undated, "me", "mama"))
        assertEquals(HindiKinTerm.MAUSI, word(undated, "me", "mausi"))
    }

    /* ------------------------------------------------------------------------- downward */

    @Test
    fun grandchildrenAreNamedByWhichChildTheyComeThrough() {
        assertWord(HindiKinTerm.BETA, "son")
        assertWord(HindiKinTerm.BETI, "daughter")
        // A son's son is पोता; a daughter's would be नाती.
        assertWord(HindiKinTerm.POTA, "grandson")
    }

    @Test
    fun niecesAndNephewsAreNamedByTheSiblingNotByThemselves() {
        assertWord(HindiKinTerm.BHATIJA, "bhatija")   // brother's son
        assertWord(HindiKinTerm.BHATIJI, "bhatiji")   // brother's daughter
        assertWord(HindiKinTerm.BHANJA, "bhanja")     // sister's son
        assertWord(HindiKinTerm.BHANJI, "bhanji")     // sister's daughter
    }

    /* -------------------------------------------------------------------------- cousins */

    /**
     * Hindi has no separate word for a cousin — they are brothers and sisters with a qualifier
     * naming the aunt or uncle they come through, which is four different words where English has
     * one.
     */
    @Test
    fun cousinsAreNamedThroughTheAuntOrUncle() {
        assertWord(HindiKinTerm.CHACHERA_BHAI, "chachera")
        assertWord(HindiKinTerm.CHACHERI_BEHEN, "chacheri")
        assertWord(HindiKinTerm.PHUPHERA_BHAI, "phuphera")
        assertWord(HindiKinTerm.PHUPHERI_BEHEN, "phupheri")
        assertWord(HindiKinTerm.MAMERA_BHAI, "mamera")
        assertWord(HindiKinTerm.MAMERI_BEHEN, "mameri")
        assertWord(HindiKinTerm.MAUSERA_BHAI, "mausera")
        assertWord(HindiKinTerm.MAUSERI_BEHEN, "mauseri")
    }

    /* ------------------------------------------------------------------------ by marriage */

    @Test
    fun theImmediateFamilyAndTheInLawsBesideIt() {
        assertWord(HindiKinTerm.PITA, "dad")
        assertWord(HindiKinTerm.MATA, "mum")
        assertWord(HindiKinTerm.BHAI, "brother")
        assertWord(HindiKinTerm.BEHEN, "sister")
        assertWord(HindiKinTerm.PATNI, "wife")
        assertWord(HindiKinTerm.SASUR, "sasur")
        assertWord(HindiKinTerm.SAAS, "saas")
    }

    /** जीजा is a sister's husband and भाभी a brother's wife — the sibling picks the word. */
    @Test
    fun aSiblingsSpouseIsNamedThroughTheSibling() {
        assertWord(HindiKinTerm.JIJA, "jija")
        assertWord(HindiKinTerm.BHABHI, "bhabhi")
    }

    /**
     * The terms that depend on who is asking. A wife's brother is साला to a man; a husband's
     * brother is जेठ or देवर to a woman, and which one depends on his age against her husband's.
     */
    @Test
    fun spousesSiblingsDependOnTheGenderOfThePersonAsking() {
        assertWord(HindiKinTerm.SALA, "sala")
        assertWord(HindiKinTerm.SALI, "sali")

        // The same two people, asked from the wife's side: her husband's brother and sister.
        assertEquals(HindiKinTerm.DEVAR, word(family(), "wife", "brother"))
        assertEquals(HindiKinTerm.NANAD, word(family(), "wife", "sister"))
    }

    @Test
    fun aHusbandsElderBrotherIsJethAndAYoungerOneDevar() {
        val f = family()
        // "brother" is born 1988, after "me" in 1985, so to my wife he is the younger — देवर.
        assertEquals(HindiKinTerm.DEVAR, word(f, "wife", "brother"))

        val elder = Builder()
            .man("dad").woman("mum")
            .man("husband", "1985").man("his-brother", "1980")
            .woman("her")
            .married("husband", "her")
            .childrenOf("dad", "mum", "husband", "his-brother")
            .build()
        assertEquals(HindiKinTerm.JETH, word(elder, "her", "his-brother"))
    }

    /* ------------------------------------------------------------- where Hindi has no word */

    /**
     * Second cousins, removed cousins and great-uncles have no everyday Hindi word, and inventing a
     * Devanagari compound nobody says would be worse than the English one the screen falls back to.
     */
    @Test
    fun relationshipsHindiHasNoWordForComeBackEmpty() {
        val distant = Builder()
            .man("great").woman("great-wife")
            .man("grandad").man("granduncle")
            .man("dad").man("cousin-parent")
            .man("me").man("second-cousin")
            .childrenOf("great", "great-wife", "grandad", "granduncle")
            .childrenOf("grandad", "unknown-a", "dad")
            .childrenOf("granduncle", "unknown-b", "cousin-parent")
            .childrenOf("dad", "unknown-c", "me")
            .childrenOf("cousin-parent", "unknown-d", "second-cousin")
            .build()

        assertNull(word(distant, "me", "second-cousin"))
        assertNull(word(distant, "me", "granduncle"))
    }

    /** A gender nobody recorded is not a word Hindi can supply, so it declines rather than guesses. */
    @Test
    fun anUnrecordedGenderMeansNoHindiWord() {
        val unknown = Builder()
            .person("dad", Gender.UNSPECIFIED)
            .person("me", Gender.UNSPECIFIED)
            .childrenOf("dad", "dad", "me")
            .build()

        assertNull(word(unknown, "me", "dad"))
    }

    /**
     * And a side the record cannot supply — a grandparent reached through a parent whose gender
     * was never written down — is left to English rather than guessed at.
     */
    @Test
    fun anUnknownSideLeavesTheGrandparentToEnglish() {
        val unknown = Builder()
            .man("grandad")
            .person("parent", Gender.UNSPECIFIED)
            .man("me")
            .childrenOf("grandad", "grandad", "parent")
            .childrenOf("parent", "parent", "me")
            .build()

        assertNull(word(unknown, "me", "grandad"))
    }
}
