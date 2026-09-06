package com.vibethroughcode.ftree.ui.common

import androidx.annotation.StringRes
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.graph.HindiKinTerm

/**
 * How a Hindi kinship term is spelled, and what it means in English.
 *
 * Only the spelling. Which term applies is decided in
 * [com.vibethroughcode.ftree.graph.HindiKinship], on the JVM and under test, precisely so that the
 * risky half of this feature is not buried in a resource lookup.
 *
 * Generated from one table, so a word and its gloss cannot drift apart.
 */
data class HindiWord(@StringRes val term: Int, @StringRes val gloss: Int)

@Suppress("CyclomaticComplexMethod")
fun HindiKinTerm.word(): HindiWord = when (this) {
    HindiKinTerm.SELF -> HindiWord(R.string.kin_hi_self, R.string.kin_hi_self_gloss)
    HindiKinTerm.PITA -> HindiWord(R.string.kin_hi_pita, R.string.kin_hi_pita_gloss)
    HindiKinTerm.MATA -> HindiWord(R.string.kin_hi_mata, R.string.kin_hi_mata_gloss)
    HindiKinTerm.DADA -> HindiWord(R.string.kin_hi_dada, R.string.kin_hi_dada_gloss)
    HindiKinTerm.DADI -> HindiWord(R.string.kin_hi_dadi, R.string.kin_hi_dadi_gloss)
    HindiKinTerm.NANA -> HindiWord(R.string.kin_hi_nana, R.string.kin_hi_nana_gloss)
    HindiKinTerm.NANI -> HindiWord(R.string.kin_hi_nani, R.string.kin_hi_nani_gloss)
    HindiKinTerm.PARDADA -> HindiWord(R.string.kin_hi_pardada, R.string.kin_hi_pardada_gloss)
    HindiKinTerm.PARDADI -> HindiWord(R.string.kin_hi_pardadi, R.string.kin_hi_pardadi_gloss)
    HindiKinTerm.PARNANA -> HindiWord(R.string.kin_hi_parnana, R.string.kin_hi_parnana_gloss)
    HindiKinTerm.PARNANI -> HindiWord(R.string.kin_hi_parnani, R.string.kin_hi_parnani_gloss)
    HindiKinTerm.BETA -> HindiWord(R.string.kin_hi_beta, R.string.kin_hi_beta_gloss)
    HindiKinTerm.BETI -> HindiWord(R.string.kin_hi_beti, R.string.kin_hi_beti_gloss)
    HindiKinTerm.POTA -> HindiWord(R.string.kin_hi_pota, R.string.kin_hi_pota_gloss)
    HindiKinTerm.POTI -> HindiWord(R.string.kin_hi_poti, R.string.kin_hi_poti_gloss)
    HindiKinTerm.NATI -> HindiWord(R.string.kin_hi_nati, R.string.kin_hi_nati_gloss)
    HindiKinTerm.NATIN -> HindiWord(R.string.kin_hi_natin, R.string.kin_hi_natin_gloss)
    HindiKinTerm.PARPOTA -> HindiWord(R.string.kin_hi_parpota, R.string.kin_hi_parpota_gloss)
    HindiKinTerm.PARPOTI -> HindiWord(R.string.kin_hi_parpoti, R.string.kin_hi_parpoti_gloss)
    HindiKinTerm.PARNATI -> HindiWord(R.string.kin_hi_parnati, R.string.kin_hi_parnati_gloss)
    HindiKinTerm.PARNATIN -> HindiWord(R.string.kin_hi_parnatin, R.string.kin_hi_parnatin_gloss)
    HindiKinTerm.BHAI -> HindiWord(R.string.kin_hi_bhai, R.string.kin_hi_bhai_gloss)
    HindiKinTerm.BEHEN -> HindiWord(R.string.kin_hi_behen, R.string.kin_hi_behen_gloss)
    HindiKinTerm.TAU -> HindiWord(R.string.kin_hi_tau, R.string.kin_hi_tau_gloss)
    HindiKinTerm.CHACHA -> HindiWord(R.string.kin_hi_chacha, R.string.kin_hi_chacha_gloss)
    HindiKinTerm.FATHERS_BROTHER -> HindiWord(R.string.kin_hi_fathers_brother, R.string.kin_hi_fathers_brother_gloss)
    HindiKinTerm.TAI -> HindiWord(R.string.kin_hi_tai, R.string.kin_hi_tai_gloss)
    HindiKinTerm.CHACHI -> HindiWord(R.string.kin_hi_chachi, R.string.kin_hi_chachi_gloss)
    HindiKinTerm.FATHERS_BROTHERS_WIFE -> HindiWord(R.string.kin_hi_fathers_brothers_wife, R.string.kin_hi_fathers_brothers_wife_gloss)
    HindiKinTerm.BUA -> HindiWord(R.string.kin_hi_bua, R.string.kin_hi_bua_gloss)
    HindiKinTerm.PHUPHA -> HindiWord(R.string.kin_hi_phupha, R.string.kin_hi_phupha_gloss)
    HindiKinTerm.MAMA -> HindiWord(R.string.kin_hi_mama, R.string.kin_hi_mama_gloss)
    HindiKinTerm.MAMI -> HindiWord(R.string.kin_hi_mami, R.string.kin_hi_mami_gloss)
    HindiKinTerm.MAUSI -> HindiWord(R.string.kin_hi_mausi, R.string.kin_hi_mausi_gloss)
    HindiKinTerm.MAUSA -> HindiWord(R.string.kin_hi_mausa, R.string.kin_hi_mausa_gloss)
    HindiKinTerm.BHATIJA -> HindiWord(R.string.kin_hi_bhatija, R.string.kin_hi_bhatija_gloss)
    HindiKinTerm.BHATIJI -> HindiWord(R.string.kin_hi_bhatiji, R.string.kin_hi_bhatiji_gloss)
    HindiKinTerm.BHANJA -> HindiWord(R.string.kin_hi_bhanja, R.string.kin_hi_bhanja_gloss)
    HindiKinTerm.BHANJI -> HindiWord(R.string.kin_hi_bhanji, R.string.kin_hi_bhanji_gloss)
    HindiKinTerm.CHACHERA_BHAI -> HindiWord(R.string.kin_hi_chachera_bhai, R.string.kin_hi_chachera_bhai_gloss)
    HindiKinTerm.CHACHERI_BEHEN -> HindiWord(R.string.kin_hi_chacheri_behen, R.string.kin_hi_chacheri_behen_gloss)
    HindiKinTerm.PHUPHERA_BHAI -> HindiWord(R.string.kin_hi_phuphera_bhai, R.string.kin_hi_phuphera_bhai_gloss)
    HindiKinTerm.PHUPHERI_BEHEN -> HindiWord(R.string.kin_hi_phupheri_behen, R.string.kin_hi_phupheri_behen_gloss)
    HindiKinTerm.MAMERA_BHAI -> HindiWord(R.string.kin_hi_mamera_bhai, R.string.kin_hi_mamera_bhai_gloss)
    HindiKinTerm.MAMERI_BEHEN -> HindiWord(R.string.kin_hi_mameri_behen, R.string.kin_hi_mameri_behen_gloss)
    HindiKinTerm.MAUSERA_BHAI -> HindiWord(R.string.kin_hi_mausera_bhai, R.string.kin_hi_mausera_bhai_gloss)
    HindiKinTerm.MAUSERI_BEHEN -> HindiWord(R.string.kin_hi_mauseri_behen, R.string.kin_hi_mauseri_behen_gloss)
    HindiKinTerm.PATI -> HindiWord(R.string.kin_hi_pati, R.string.kin_hi_pati_gloss)
    HindiKinTerm.PATNI -> HindiWord(R.string.kin_hi_patni, R.string.kin_hi_patni_gloss)
    HindiKinTerm.SASUR -> HindiWord(R.string.kin_hi_sasur, R.string.kin_hi_sasur_gloss)
    HindiKinTerm.SAAS -> HindiWord(R.string.kin_hi_saas, R.string.kin_hi_saas_gloss)
    HindiKinTerm.JIJA -> HindiWord(R.string.kin_hi_jija, R.string.kin_hi_jija_gloss)
    HindiKinTerm.BHABHI -> HindiWord(R.string.kin_hi_bhabhi, R.string.kin_hi_bhabhi_gloss)
    HindiKinTerm.BAHU -> HindiWord(R.string.kin_hi_bahu, R.string.kin_hi_bahu_gloss)
    HindiKinTerm.DAMAD -> HindiWord(R.string.kin_hi_damad, R.string.kin_hi_damad_gloss)
    HindiKinTerm.SALA -> HindiWord(R.string.kin_hi_sala, R.string.kin_hi_sala_gloss)
    HindiKinTerm.SALI -> HindiWord(R.string.kin_hi_sali, R.string.kin_hi_sali_gloss)
    HindiKinTerm.JETH -> HindiWord(R.string.kin_hi_jeth, R.string.kin_hi_jeth_gloss)
    HindiKinTerm.DEVAR -> HindiWord(R.string.kin_hi_devar, R.string.kin_hi_devar_gloss)
    HindiKinTerm.HUSBANDS_BROTHER -> HindiWord(R.string.kin_hi_husbands_brother, R.string.kin_hi_husbands_brother_gloss)
    HindiKinTerm.NANAD -> HindiWord(R.string.kin_hi_nanad, R.string.kin_hi_nanad_gloss)
    HindiKinTerm.SAUTELA_PITA -> HindiWord(R.string.kin_hi_sautela_pita, R.string.kin_hi_sautela_pita_gloss)
    HindiKinTerm.SAUTELI_MATA -> HindiWord(R.string.kin_hi_sauteli_mata, R.string.kin_hi_sauteli_mata_gloss)
    HindiKinTerm.SAUTELA_BETA -> HindiWord(R.string.kin_hi_sautela_beta, R.string.kin_hi_sautela_beta_gloss)
    HindiKinTerm.SAUTELI_BETI -> HindiWord(R.string.kin_hi_sauteli_beti, R.string.kin_hi_sauteli_beti_gloss)
}
