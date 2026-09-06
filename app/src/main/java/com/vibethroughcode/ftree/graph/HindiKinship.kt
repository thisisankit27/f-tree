package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Gender

/**
 * A Hindi kinship word, chosen but not yet spelled.
 *
 * An enum rather than a string so the *decision* — which of five words English calls "uncle" — is
 * ordinary Kotlin that runs on the JVM and is tested there. The spelling lives in resources, where a
 * Hindi speaker can review the whole vocabulary as a flat list without reading any code.
 *
 * [needsBirthYears] marks the three descriptive terms the app falls back to when the record cannot
 * settle a birth order. They are correct as they stand — "पिता के भाई" is what he is — and the screen
 * uses the flag to offer the reader a way to sharpen them.
 */
enum class HindiKinTerm(val needsBirthYears: Boolean = false) {
    SELF,

    /* ------------------------------------------------------------------------ blood, upward */
    PITA, MATA,
    DADA, DADI, NANA, NANI,
    PARDADA, PARDADI, PARNANA, PARNANI,

    /* ---------------------------------------------------------------------- blood, downward */
    BETA, BETI,
    POTA, POTI, NATI, NATIN,
    PARPOTA, PARPOTI, PARNATI, PARNATIN,

    /* ------------------------------------------------------------------------ blood, beside */
    BHAI, BEHEN,

    /**
     * Father's brother, and his wife.
     *
     * The one place Hindi asks a question the record often cannot answer: ताऊ is the elder brother
     * and चाचा the younger, and with no birth years there is no way to tell. Guessing would be wrong
     * half the time in a way the family notices immediately.
     */
    TAU, CHACHA, FATHERS_BROTHER(needsBirthYears = true),
    TAI, CHACHI, FATHERS_BROTHERS_WIFE(needsBirthYears = true),

    /** Father's sister and her husband; mother's brother and his wife; mother's sister and hers. */
    BUA, PHUPHA,
    MAMA, MAMI,
    MAUSI, MAUSA,

    BHATIJA, BHATIJI, BHANJA, BHANJI,

    /**
     * First cousins, who in Hindi are brothers and sisters with a qualifier saying which aunt or
     * uncle they come through. Deliberately blind to birth order: चचेरा covers both ताऊ's children
     * and चाचा's in ordinary speech, so cousins never depend on a birth year.
     */
    CHACHERA_BHAI, CHACHERI_BEHEN,
    PHUPHERA_BHAI, PHUPHERI_BEHEN,
    MAMERA_BHAI, MAMERI_BEHEN,
    MAUSERA_BHAI, MAUSERI_BEHEN,

    /* ------------------------------------------------------------------------- by marriage */
    PATI, PATNI,
    SASUR, SAAS,
    JIJA, BHABHI,
    BAHU, DAMAD,
    SALA, SALI,
    JETH, DEVAR, HUSBANDS_BROTHER(needsBirthYears = true),
    NANAD,
    SAUTELA_PITA, SAUTELI_MATA,
    SAUTELA_BETA, SAUTELI_BETI,
}

/**
 * Which Hindi word a relationship takes.
 *
 * Pure, and deliberately so: this is the part that can be wrong. English collapses five Hindi terms
 * into "uncle", so a labelling layer working from [KinshipTerm] alone could only guess. Everything
 * here reads [KinshipPath] — which parent the line went up through, who it came back down through,
 * and who was born first — and returns null wherever Hindi genuinely has no word, which is exactly
 * where a Hindi speaker would reach for the English one anyway.
 */
object HindiKinship {

    /**
     * @param subject the person the relationship is *from*. Hindi in-law terms depend on it: a
     *   wife's brother is साला to a man, where a husband's brother is जेठ or देवर to a woman.
     */
    fun term(
        term: KinshipTerm,
        path: KinshipPath?,
        subject: Gender,
        target: Gender,
    ): HindiKinTerm? = when (term) {
        KinshipTerm.Self -> HindiKinTerm.SELF

        is KinshipTerm.Ancestor -> ancestor(term.generations, path, target)
        is KinshipTerm.Descendant -> descendant(term.generations, path, target)

        KinshipTerm.Sibling -> byGender(target, HindiKinTerm.BHAI, HindiKinTerm.BEHEN)

        is KinshipTerm.ParentsSibling ->
            if (term.greats > 0) null else parentsSibling(path, target)

        is KinshipTerm.SiblingsChild ->
            if (term.greats > 0) null else siblingsChild(path, target)

        is KinshipTerm.Cousin ->
            if (term.degree != 1 || term.removed != 0) null else firstCousin(path, target)

        KinshipTerm.Spouse -> byGender(target, HindiKinTerm.PATI, HindiKinTerm.PATNI)

        is KinshipTerm.SpouseOf -> marriedIn(term.relative, path, target)
        is KinshipTerm.OfSpouse -> ofSpouse(term.relative, path, subject, target)
    }

    /* ------------------------------------------------------------------------------- blood */

    private fun ancestor(generations: Int, path: KinshipPath?, target: Gender): HindiKinTerm? =
        when (generations) {
            1 -> byGender(target, HindiKinTerm.PITA, HindiKinTerm.MATA)
            // दादा is the father's father, नाना the mother's — the side is the whole distinction.
            2 -> when (path?.side) {
                Gender.MALE -> byGender(target, HindiKinTerm.DADA, HindiKinTerm.DADI)
                Gender.FEMALE -> byGender(target, HindiKinTerm.NANA, HindiKinTerm.NANI)
                else -> null
            }
            3 -> when (path?.side) {
                Gender.MALE -> byGender(target, HindiKinTerm.PARDADA, HindiKinTerm.PARDADI)
                Gender.FEMALE -> byGender(target, HindiKinTerm.PARNANA, HindiKinTerm.PARNANI)
                else -> null
            }
            // पर- stacks no further in ordinary speech, so the English word serves better.
            else -> null
        }

    private fun descendant(generations: Int, path: KinshipPath?, target: Gender): HindiKinTerm? =
        when (generations) {
            1 -> byGender(target, HindiKinTerm.BETA, HindiKinTerm.BETI)
            // A son's children are पोता/पोती, a daughter's नाती/नातिन — the child in between decides.
            2 -> when (path?.link) {
                Gender.MALE -> byGender(target, HindiKinTerm.POTA, HindiKinTerm.POTI)
                Gender.FEMALE -> byGender(target, HindiKinTerm.NATI, HindiKinTerm.NATIN)
                else -> null
            }
            3 -> when (path?.link) {
                Gender.MALE -> byGender(target, HindiKinTerm.PARPOTA, HindiKinTerm.PARPOTI)
                Gender.FEMALE -> byGender(target, HindiKinTerm.PARNATI, HindiKinTerm.PARNATIN)
                else -> null
            }
            else -> null
        }

    private fun parentsSibling(path: KinshipPath?, target: Gender): HindiKinTerm? =
        when (path?.side) {
            Gender.MALE -> when (target) {
                Gender.FEMALE -> HindiKinTerm.BUA
                Gender.MALE -> elderYounger(
                    path.seniority, HindiKinTerm.TAU, HindiKinTerm.CHACHA, HindiKinTerm.FATHERS_BROTHER,
                )
                else -> null
            }
            // Neither मामा nor मौसी cares about birth order, which is why only the father's side
            // ever has to ask the record for a birth year.
            Gender.FEMALE -> byGender(target, HindiKinTerm.MAMA, HindiKinTerm.MAUSI)
            else -> null
        }

    private fun siblingsChild(path: KinshipPath?, target: Gender): HindiKinTerm? =
        when (path?.link) {
            Gender.MALE -> byGender(target, HindiKinTerm.BHATIJA, HindiKinTerm.BHATIJI)
            Gender.FEMALE -> byGender(target, HindiKinTerm.BHANJA, HindiKinTerm.BHANJI)
            else -> null
        }

    private fun firstCousin(path: KinshipPath?, target: Gender): HindiKinTerm? {
        val side = path?.side ?: return null
        return when (side to path.link) {
            Gender.MALE to Gender.MALE ->
                byGender(target, HindiKinTerm.CHACHERA_BHAI, HindiKinTerm.CHACHERI_BEHEN)
            Gender.MALE to Gender.FEMALE ->
                byGender(target, HindiKinTerm.PHUPHERA_BHAI, HindiKinTerm.PHUPHERI_BEHEN)
            Gender.FEMALE to Gender.MALE ->
                byGender(target, HindiKinTerm.MAMERA_BHAI, HindiKinTerm.MAMERI_BEHEN)
            Gender.FEMALE to Gender.FEMALE ->
                byGender(target, HindiKinTerm.MAUSERA_BHAI, HindiKinTerm.MAUSERI_BEHEN)
            else -> null
        }
    }

    /* -------------------------------------------------------------------------- by marriage */

    /**
     * Married to one of the subject's blood relatives. [path] runs to that relative.
     *
     * Every word here names *both* people: जीजा is a man married to a sister, भाभी a woman married
     * to a brother. So both genders have to agree before one is used. A record saying otherwise —
     * a marriage between two people both written down as male, most often a gender entered wrongly —
     * gets no word rather than a confident falsehood, and the chain still answers the question.
     */
    private fun marriedIn(
        relative: KinshipTerm,
        path: KinshipPath?,
        target: Gender,
    ): HindiKinTerm? = when (relative) {
        is KinshipTerm.ParentsSibling -> if (relative.greats > 0) null else {
            when (Triple(path?.side, path?.link, target)) {
                // Father's sister's husband, and father's brother's wife.
                Triple(Gender.MALE, Gender.FEMALE, Gender.MALE) -> HindiKinTerm.PHUPHA
                Triple(Gender.MALE, Gender.MALE, Gender.FEMALE) -> elderYounger(
                    path!!.seniority,
                    HindiKinTerm.TAI,
                    HindiKinTerm.CHACHI,
                    HindiKinTerm.FATHERS_BROTHERS_WIFE,
                )
                // Mother's brother's wife, and mother's sister's husband.
                Triple(Gender.FEMALE, Gender.MALE, Gender.FEMALE) -> HindiKinTerm.MAMI
                Triple(Gender.FEMALE, Gender.FEMALE, Gender.MALE) -> HindiKinTerm.MAUSA
                else -> null
            }
        }

        KinshipTerm.Sibling -> spouseOfSibling(path?.link, target)

        is KinshipTerm.Descendant -> if (relative.generations != 1) null else {
            when (path?.link to target) {
                Gender.MALE to Gender.FEMALE -> HindiKinTerm.BAHU
                Gender.FEMALE to Gender.MALE -> HindiKinTerm.DAMAD
                else -> null
            }
        }

        is KinshipTerm.Ancestor -> if (relative.generations != 1) null else {
            byGender(target, HindiKinTerm.SAUTELA_PITA, HindiKinTerm.SAUTELI_MATA)
        }

        else -> null
    }

    /** जीजा married a sister, भाभी married a brother — neither word works without both facts. */
    private fun spouseOfSibling(sibling: Gender?, target: Gender): HindiKinTerm? =
        when (sibling to target) {
            Gender.FEMALE to Gender.MALE -> HindiKinTerm.JIJA
            Gender.MALE to Gender.FEMALE -> HindiKinTerm.BHABHI
            else -> null
        }

    /** A blood relative of the subject's own spouse. [path] runs from the spouse to them. */
    private fun ofSpouse(
        relative: KinshipTerm,
        path: KinshipPath?,
        subject: Gender,
        target: Gender,
    ): HindiKinTerm? = when (relative) {
        is KinshipTerm.Ancestor -> if (relative.generations != 1) null else {
            byGender(target, HindiKinTerm.SASUR, HindiKinTerm.SAAS)
        }

        // The one family of terms that turns on the gender of the person *asking*: a wife's brother
        // is साला, a husband's brother जेठ or देवर. Without knowing which, there is no word to give.
        KinshipTerm.Sibling -> when (subject) {
            Gender.MALE -> byGender(target, HindiKinTerm.SALA, HindiKinTerm.SALI)
            Gender.FEMALE -> when (target) {
                Gender.FEMALE -> HindiKinTerm.NANAD
                Gender.MALE -> elderYounger(
                    path?.seniority ?: Seniority.UNKNOWN,
                    HindiKinTerm.JETH,
                    HindiKinTerm.DEVAR,
                    HindiKinTerm.HUSBANDS_BROTHER,
                )
                else -> null
            }
            else -> null
        }

        is KinshipTerm.Descendant -> if (relative.generations != 1) null else {
            byGender(target, HindiKinTerm.SAUTELA_BETA, HindiKinTerm.SAUTELI_BETI)
        }

        else -> null
    }

    /* ------------------------------------------------------------------------------ helpers */

    private fun byGender(gender: Gender, male: HindiKinTerm, female: HindiKinTerm): HindiKinTerm? =
        when (gender) {
            Gender.MALE -> male
            Gender.FEMALE -> female
            // Hindi has no neuter kinship word here; the English one is the better answer.
            else -> null
        }

    private fun elderYounger(
        seniority: Seniority,
        elder: HindiKinTerm,
        younger: HindiKinTerm,
        unknown: HindiKinTerm,
    ): HindiKinTerm = when (seniority) {
        Seniority.ELDER -> elder
        Seniority.YOUNGER -> younger
        Seniority.UNKNOWN -> unknown
    }
}
