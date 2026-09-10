/*
 * The Hindi family vocabulary: how each term is spelled, and what it means in English.
 *
 * Generated from `app/src/main/res/values/kinship_hi.xml`, which is where a Hindi speaker reviews
 * the whole word list as a flat list without reading any code. `kinship-hi.test.mjs` reads that XML
 * and asserts this table matches it exactly, so the two cannot drift -- and the parity test is the
 * reason this file is a table rather than something clever.
 *
 * The word and its gloss live in one entry on purpose. They were two resources on the phone,
 * `kin_hi_bua` and `kin_hi_bua_gloss`, and two lists of 65 things are two lists that can lose their
 * alignment. Here a term is one object or it is nothing.
 *
 * The glosses are more precise than English's own kinship words, deliberately. English says "uncle"
 * five different ways; the gloss says which one, so a younger relative who does not know फूफा can
 * still read the answer, and nothing is lost by reading it in English.
 *
 * `needsBirthYears` marks the three descriptive terms the app falls back to when the record cannot
 * settle a birth order. They are correct as they stand -- "पिता के भाई" is what he is -- and the
 * screen uses the flag to offer the reader a way to sharpen them.
 */

export const HINDI_WORDS = Object.freeze({
  SELF: { word: 'स्वयं', gloss: "themselves" },
  PITA: { word: 'पिता', gloss: "father" },
  MATA: { word: 'माता', gloss: "mother" },
  DADA: { word: 'दादा', gloss: "father's father" },
  DADI: { word: 'दादी', gloss: "father's mother" },
  NANA: { word: 'नाना', gloss: "mother's father" },
  NANI: { word: 'नानी', gloss: "mother's mother" },
  PARDADA: { word: 'परदादा', gloss: "father's grandfather" },
  PARDADI: { word: 'परदादी', gloss: "father's grandmother" },
  PARNANA: { word: 'परनाना', gloss: "mother's grandfather" },
  PARNANI: { word: 'परनानी', gloss: "mother's grandmother" },
  BETA: { word: 'बेटा', gloss: "son" },
  BETI: { word: 'बेटी', gloss: "daughter" },
  POTA: { word: 'पोता', gloss: "son's son" },
  POTI: { word: 'पोती', gloss: "son's daughter" },
  NATI: { word: 'नाती', gloss: "daughter's son" },
  NATIN: { word: 'नातिन', gloss: "daughter's daughter" },
  PARPOTA: { word: 'परपोता', gloss: "son's grandson" },
  PARPOTI: { word: 'परपोती', gloss: "son's granddaughter" },
  PARNATI: { word: 'परनाती', gloss: "daughter's grandson" },
  PARNATIN: { word: 'परनातिन', gloss: "daughter's granddaughter" },
  BHAI: { word: 'भाई', gloss: "brother" },
  BEHEN: { word: 'बहन', gloss: "sister" },
  TAU: { word: 'ताऊ', gloss: "father's elder brother" },
  CHACHA: { word: 'चाचा', gloss: "father's younger brother" },
  FATHERS_BROTHER: { word: 'पिता के भाई', gloss: "father's brother", needsBirthYears: true },
  TAI: { word: 'ताई', gloss: "father's elder brother's wife" },
  CHACHI: { word: 'चाची', gloss: "father's younger brother's wife" },
  FATHERS_BROTHERS_WIFE: { word: 'पिता के भाई की पत्नी', gloss: "father's brother's wife", needsBirthYears: true },
  BUA: { word: 'बुआ', gloss: "father's sister" },
  PHUPHA: { word: 'फूफा', gloss: "father's sister's husband" },
  MAMA: { word: 'मामा', gloss: "mother's brother" },
  MAMI: { word: 'मामी', gloss: "mother's brother's wife" },
  MAUSI: { word: 'मौसी', gloss: "mother's sister" },
  MAUSA: { word: 'मौसा', gloss: "mother's sister's husband" },
  BHATIJA: { word: 'भतीजा', gloss: "brother's son" },
  BHATIJI: { word: 'भतीजी', gloss: "brother's daughter" },
  BHANJA: { word: 'भांजा', gloss: "sister's son" },
  BHANJI: { word: 'भांजी', gloss: "sister's daughter" },
  CHACHERA_BHAI: { word: 'चचेरा भाई', gloss: "father's brother's son" },
  CHACHERI_BEHEN: { word: 'चचेरी बहन', gloss: "father's brother's daughter" },
  PHUPHERA_BHAI: { word: 'फुफेरा भाई', gloss: "father's sister's son" },
  PHUPHERI_BEHEN: { word: 'फुफेरी बहन', gloss: "father's sister's daughter" },
  MAMERA_BHAI: { word: 'ममेरा भाई', gloss: "mother's brother's son" },
  MAMERI_BEHEN: { word: 'ममेरी बहन', gloss: "mother's brother's daughter" },
  MAUSERA_BHAI: { word: 'मौसेरा भाई', gloss: "mother's sister's son" },
  MAUSERI_BEHEN: { word: 'मौसेरी बहन', gloss: "mother's sister's daughter" },
  PATI: { word: 'पति', gloss: "husband" },
  PATNI: { word: 'पत्नी', gloss: "wife" },
  SASUR: { word: 'ससुर', gloss: "father-in-law" },
  SAAS: { word: 'सास', gloss: "mother-in-law" },
  JIJA: { word: 'जीजा', gloss: "sister's husband" },
  BHABHI: { word: 'भाभी', gloss: "brother's wife" },
  BAHU: { word: 'बहू', gloss: "son's wife" },
  DAMAD: { word: 'दामाद', gloss: "daughter's husband" },
  SALA: { word: 'साला', gloss: "wife's brother" },
  SALI: { word: 'साली', gloss: "wife's sister" },
  JETH: { word: 'जेठ', gloss: "husband's elder brother" },
  DEVAR: { word: 'देवर', gloss: "husband's younger brother" },
  HUSBANDS_BROTHER: { word: 'पति के भाई', gloss: "husband's brother", needsBirthYears: true },
  NANAD: { word: 'ननद', gloss: "husband's sister" },
  SAUTELA_PITA: { word: 'सौतेला पिता', gloss: "stepfather" },
  SAUTELI_MATA: { word: 'सौतेली माता', gloss: "stepmother" },
  SAUTELA_BETA: { word: 'सौतेला बेटा', gloss: "stepson" },
  SAUTELI_BETI: { word: 'सौतेली बेटी', gloss: "stepdaughter" },
});

/** Every term this vocabulary spells. */
export const HINDI_TERMS = Object.freeze(Object.keys(HINDI_WORDS));

/**
 * The word and gloss for a term, or null where Hindi has no word for the relationship.
 *
 * Null is a real answer here rather than a gap: Hindi genuinely has no single word for a
 * second cousin, or for a relative reached through two marriages, and the honest thing is to fall
 * back to the English term the rest of the app already gives -- which is what a Hindi speaker would
 * reach for in the same conversation.
 */
export function hindiWord(term) {
  return (term && HINDI_WORDS[term]) || null;
}
