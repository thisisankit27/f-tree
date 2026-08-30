package com.vibethroughcode.ftree.transfer

import java.text.Normalizer
import java.util.Locale

/**
 * A name reduced to what two spellings of the same person have in common.
 *
 * Accents, capitalisation, punctuation and stray spacing all differ between people typing the same
 * name into two different phones, and none of those differences mean it is a different person.
 * Deliberately conservative: it normalises *form*, never content. "Raj Kumar" and "R. Kumar" stay
 * different, because guessing they are the same is how a merge quietly destroys someone's data.
 */
fun nameKey(name: String?): String? {
    val trimmed = name?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val withoutAccents = Normalizer.normalize(trimmed, Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}+"), "")
    return withoutAccents
        .lowercase(Locale.ROOT)
        .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
        .trim()
        .takeIf { it.isNotEmpty() }
}
