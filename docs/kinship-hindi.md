# The Hindi family vocabulary

f-tree can name relationships in Hindi instead of English — **Settings → Family words**. This page
is the whole vocabulary, so a Hindi speaker can check the words without reading any Kotlin.

## Why this is not a translation

English has one word where Hindi has five. "Uncle" is चाचा, ताऊ, मामा, फूफा or मौसा depending on
facts English throws away, so a label-swap would confidently print the wrong word — and a wrong
Hindi word is worse than a vague English one, because a Hindi speaker sees the mistake instantly.

Choosing correctly needs three things the app now keeps alongside every relationship
(`graph/Kinship.kt`, `KinshipPath`):

| | example |
|---|---|
| **which side** the line goes up through | मामा is a mother's brother, चाचा a father's |
| **who links** the two people | भतीजा is a *brother's* son, भांजा a *sister's* |
| **who was born first** | ताऊ is a father's elder brother, चाचा the younger |

## What happens when the record cannot say

Only one distinction depends on a birth year — a father's brother — and only there does the app fall
back. With no years to compare it says **पिता के भाई** (father's brother), which is true, and offers
to sharpen it if the years are added. It never guesses between चाचा and ताऊ: that would be wrong
about half the time, in a way the family notices immediately.

Cousins deliberately ignore birth order: चचेरा covers both ताऊ's children and चाचा's in ordinary
speech, so no cousin ever depends on a date.

Hindi has no gender-neutral kinship word, so a person whose gender was never recorded gets no Hindi
term and the English one is used instead.

## Where Hindi stops

Second cousins, cousins once removed, great-uncles — Hindi has no everyday word for these, and the
app falls back to the English one rather than inventing a Devanagari compound nobody says. That is
what Hindi speakers do themselves.

## The words

Each is shown with its meaning in brackets: **मामा (mother's brother)**. The meanings are more
precise than English's own kinship words on purpose — "uncle" would not say which one.

| Word | Means | Reached by |
|---|---|---|
| **स्वयं** | themselves | `SELF` |
| **पिता** | father | `PITA` |
| **माता** | mother | `MATA` |
| **दादा** | father's father | `DADA` |
| **दादी** | father's mother | `DADI` |
| **नाना** | mother's father | `NANA` |
| **नानी** | mother's mother | `NANI` |
| **परदादा** | father's grandfather | `PARDADA` |
| **परदादी** | father's grandmother | `PARDADI` |
| **परनाना** | mother's grandfather | `PARNANA` |
| **परनानी** | mother's grandmother | `PARNANI` |
| **बेटा** | son | `BETA` |
| **बेटी** | daughter | `BETI` |
| **पोता** | son's son | `POTA` |
| **पोती** | son's daughter | `POTI` |
| **नाती** | daughter's son | `NATI` |
| **नातिन** | daughter's daughter | `NATIN` |
| **परपोता** | son's grandson | `PARPOTA` |
| **परपोती** | son's granddaughter | `PARPOTI` |
| **परनाती** | daughter's grandson | `PARNATI` |
| **परनातिन** | daughter's granddaughter | `PARNATIN` |
| **भाई** | brother | `BHAI` |
| **बहन** | sister | `BEHEN` |
| **ताऊ** | father's elder brother | `TAU` |
| **चाचा** | father's younger brother | `CHACHA` |
| **पिता के भाई** | father's brother | `FATHERS_BROTHER` |
| **ताई** | father's elder brother's wife | `TAI` |
| **चाची** | father's younger brother's wife | `CHACHI` |
| **पिता के भाई की पत्नी** | father's brother's wife | `FATHERS_BROTHERS_WIFE` |
| **बुआ** | father's sister | `BUA` |
| **फूफा** | father's sister's husband | `PHUPHA` |
| **मामा** | mother's brother | `MAMA` |
| **मामी** | mother's brother's wife | `MAMI` |
| **मौसी** | mother's sister | `MAUSI` |
| **मौसा** | mother's sister's husband | `MAUSA` |
| **भतीजा** | brother's son | `BHATIJA` |
| **भतीजी** | brother's daughter | `BHATIJI` |
| **भांजा** | sister's son | `BHANJA` |
| **भांजी** | sister's daughter | `BHANJI` |
| **चचेरा भाई** | father's brother's son | `CHACHERA_BHAI` |
| **चचेरी बहन** | father's brother's daughter | `CHACHERI_BEHEN` |
| **फुफेरा भाई** | father's sister's son | `PHUPHERA_BHAI` |
| **फुफेरी बहन** | father's sister's daughter | `PHUPHERI_BEHEN` |
| **ममेरा भाई** | mother's brother's son | `MAMERA_BHAI` |
| **ममेरी बहन** | mother's brother's daughter | `MAMERI_BEHEN` |
| **मौसेरा भाई** | mother's sister's son | `MAUSERA_BHAI` |
| **मौसेरी बहन** | mother's sister's daughter | `MAUSERI_BEHEN` |
| **पति** | husband | `PATI` |
| **पत्नी** | wife | `PATNI` |
| **ससुर** | father-in-law | `SASUR` |
| **सास** | mother-in-law | `SAAS` |
| **जीजा** | sister's husband | `JIJA` |
| **भाभी** | brother's wife | `BHABHI` |
| **बहू** | son's wife | `BAHU` |
| **दामाद** | daughter's husband | `DAMAD` |
| **साला** | wife's brother | `SALA` |
| **साली** | wife's sister | `SALI` |
| **जेठ** | husband's elder brother | `JETH` |
| **देवर** | husband's younger brother | `DEVAR` |
| **पति के भाई** | husband's brother | `HUSBANDS_BROTHER` |
| **ननद** | husband's sister | `NANAD` |
| **सौतेला पिता** | stepfather | `SAUTELA_PITA` |
| **सौतेली माता** | stepmother | `SAUTELI_MATA` |
| **सौतेला बेटा** | stepson | `SAUTELA_BETA` |
| **सौतेली बेटी** | stepdaughter | `SAUTELI_BETI` |
## Checking these

Two suites, both on the JVM:

- `HindiKinshipTest` — every word above, pinned to the family shape it comes from.
- `HindiEveryPairTest` — every ordered pair of a whole family, asserting that each relationship
  agrees with its opposite number: **if B is A's मामा, then A must be B's भांजा or भांजी.** The two
  answers are computed independently from opposite ends of the graph, so a mistake in "which side"
  or "who links them" makes them disagree. Cousins are the sharpest case — a फुफेरा भाई must see you
  as his ममेरा भाई, never as another फुफेरा.

Run it against a real exported tree with:

```bash
./gradlew testDebugUnitTest -Dftree.tree=/path/to/family.ftree
```

It reports coverage and names any marriage the record states inconsistently — both partners with the
same recorded gender — which is usually a gender entered wrongly and worth fixing.
