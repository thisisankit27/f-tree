/*
 * Which Hindi word a relationship takes.
 *
 * A port of `app/.../graph/HindiKinship.kt`, with its test table. Pure, and deliberately so: this
 * is the part that can be wrong.
 *
 * English collapses five Hindi terms into "uncle", so a labelling layer working from the kinship
 * term alone could only guess. Everything here reads `relate(...).kinship` -- which parent the line
 * went up through, who it came back down through, and who was born first -- and returns null
 * wherever Hindi genuinely has no word.
 *
 * **Null is a real answer.** Hindi has no single word for a second cousin, or for a relative reached
 * through two marriages, and where it has none the honest thing is to fall back to the English term
 * the rest of the app already gives -- which is what a Hindi speaker would reach for in the same
 * conversation. A word invented to fill the gap would be worse than the English one.
 *
 * `model.js` is not touched by this file, and does not know it exists. The vocabulary reads the
 * engine; the engine never reads the vocabulary.
 */

/** The male word, the female word, or null: Hindi has no neuter kinship term to fall back on. */
function byGender(gender, male, female) {
  if (gender === 'MALE') return male;
  if (gender === 'FEMALE') return female;
  return null;
}

/**
 * Elder, younger, or the descriptive term where the record cannot say.
 *
 * The `unknown` word is not a failure. "पिता के भाई" is exactly what he is, and it is a better
 * answer than picking ताऊ or चाचा and being wrong half the time in a way the family notices
 * immediately.
 */
function elderYounger(seniority, elder, younger, unknown) {
  if (seniority === 'ELDER') return elder;
  if (seniority === 'YOUNGER') return younger;
  return unknown;
}

/* ------------------------------------------------------------------------------------ blood */

function ancestor(generations, path, target) {
  if (generations === 1) return byGender(target, 'PITA', 'MATA');

  // दादा is the father's father, नाना the mother's -- the side *is* the whole distinction.
  if (generations === 2) {
    if (path?.side === 'MALE') return byGender(target, 'DADA', 'DADI');
    if (path?.side === 'FEMALE') return byGender(target, 'NANA', 'NANI');
    return null;
  }
  if (generations === 3) {
    if (path?.side === 'MALE') return byGender(target, 'PARDADA', 'PARDADI');
    if (path?.side === 'FEMALE') return byGender(target, 'PARNANA', 'PARNANI');
    return null;
  }
  // पर- stacks no further in ordinary speech, so the English word serves better.
  return null;
}

function descendant(generations, path, target) {
  if (generations === 1) return byGender(target, 'BETA', 'BETI');

  // A son's children are पोता/पोती, a daughter's नाती/नातिन -- the child in between decides.
  if (generations === 2) {
    if (path?.link === 'MALE') return byGender(target, 'POTA', 'POTI');
    if (path?.link === 'FEMALE') return byGender(target, 'NATI', 'NATIN');
    return null;
  }
  if (generations === 3) {
    if (path?.link === 'MALE') return byGender(target, 'PARPOTA', 'PARPOTI');
    if (path?.link === 'FEMALE') return byGender(target, 'PARNATI', 'PARNATIN');
    return null;
  }
  return null;
}

function parentsSibling(path, target) {
  if (path?.side === 'MALE') {
    if (target === 'FEMALE') return 'BUA';
    if (target === 'MALE') {
      return elderYounger(path.seniority, 'TAU', 'CHACHA', 'FATHERS_BROTHER');
    }
    return null;
  }
  // Neither मामा nor मौसी cares about birth order, which is why only the father's side ever has to
  // ask the record for a birth year.
  if (path?.side === 'FEMALE') return byGender(target, 'MAMA', 'MAUSI');
  return null;
}

function siblingsChild(path, target) {
  if (path?.link === 'MALE') return byGender(target, 'BHATIJA', 'BHATIJI');
  if (path?.link === 'FEMALE') return byGender(target, 'BHANJA', 'BHANJI');
  return null;
}

function firstCousin(path, target) {
  const side = path?.side;
  const link = path?.link;
  if (side === 'MALE' && link === 'MALE') return byGender(target, 'CHACHERA_BHAI', 'CHACHERI_BEHEN');
  if (side === 'MALE' && link === 'FEMALE') return byGender(target, 'PHUPHERA_BHAI', 'PHUPHERI_BEHEN');
  if (side === 'FEMALE' && link === 'MALE') return byGender(target, 'MAMERA_BHAI', 'MAMERI_BEHEN');
  if (side === 'FEMALE' && link === 'FEMALE') return byGender(target, 'MAUSERA_BHAI', 'MAUSERI_BEHEN');
  return null;
}

/* ------------------------------------------------------------------------------- by marriage */

/** जीजा married a sister, भाभी married a brother -- neither word works without both facts. */
function spouseOfSibling(sibling, target) {
  if (sibling === 'FEMALE' && target === 'MALE') return 'JIJA';
  if (sibling === 'MALE' && target === 'FEMALE') return 'BHABHI';
  return null;
}

/**
 * Married to one of the subject's blood relatives. The path runs to that relative.
 *
 * Every word here names *both* people: जीजा is a man married to a sister, भाभी a woman married to a
 * brother. So both genders have to agree before one is used. A record saying otherwise -- a marriage
 * between two people both written down as male, most often a gender entered wrongly -- gets no word
 * rather than a confident falsehood, and the chain still answers the question.
 */
function marriedIn(relative, path, target) {
  switch (relative?.kind) {
    case 'parents-sibling': {
      if (relative.greats > 0) return null;
      const { side, link } = path ?? {};
      // Father's sister's husband, and father's brother's wife.
      if (side === 'MALE' && link === 'FEMALE' && target === 'MALE') return 'PHUPHA';
      if (side === 'MALE' && link === 'MALE' && target === 'FEMALE') {
        return elderYounger(path.seniority, 'TAI', 'CHACHI', 'FATHERS_BROTHERS_WIFE');
      }
      // Mother's brother's wife, and mother's sister's husband.
      if (side === 'FEMALE' && link === 'MALE' && target === 'FEMALE') return 'MAMI';
      if (side === 'FEMALE' && link === 'FEMALE' && target === 'MALE') return 'MAUSA';
      return null;
    }

    case 'sibling':
      return spouseOfSibling(path?.link, target);

    case 'descendant': {
      if (relative.generations !== 1) return null;
      if (path?.link === 'MALE' && target === 'FEMALE') return 'BAHU';
      if (path?.link === 'FEMALE' && target === 'MALE') return 'DAMAD';
      return null;
    }

    case 'ancestor':
      return relative.generations !== 1 ? null : byGender(target, 'SAUTELA_PITA', 'SAUTELI_MATA');

    default:
      return null;
  }
}

/** A blood relative of the subject's own spouse. The path runs from the spouse to them. */
function ofSpouse(relative, path, subject, target) {
  switch (relative?.kind) {
    case 'ancestor':
      return relative.generations !== 1 ? null : byGender(target, 'SASUR', 'SAAS');

    /*
     * The one family of terms that turns on the gender of the person *asking*.
     *
     * A wife's brother is साला; a husband's brother is जेठ or देवर. Without knowing which, there is
     * no word to give -- which is why the subject's gender is carried separately from the target's
     * all the way down here.
     */
    case 'sibling': {
      if (subject === 'MALE') return byGender(target, 'SALA', 'SALI');
      if (subject === 'FEMALE') {
        if (target === 'FEMALE') return 'NANAD';
        if (target === 'MALE') {
          return elderYounger(path?.seniority ?? 'UNKNOWN', 'JETH', 'DEVAR', 'HUSBANDS_BROTHER');
        }
        return null;
      }
      return null;
    }

    case 'descendant':
      return relative.generations !== 1 ? null : byGender(target, 'SAUTELA_BETA', 'SAUTELI_BETI');

    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------ entry */

/**
 * The Hindi term for a relationship, or null where Hindi has no word for it.
 *
 * `kinship` is `relate(...).kinship`: the structured term and the path it was measured over.
 * `subject` is the gender of the person the relationship is *from*, which several in-law terms turn
 * on, and `target` the gender of the person it is *to*.
 */
export function hindiTerm(kinship, subject, target) {
  const term = kinship?.term;
  if (!term) return null;

  switch (term.kind) {
    case 'self':
      return 'SELF';
    case 'ancestor':
      return ancestor(term.generations, kinship, target);
    case 'descendant':
      return descendant(term.generations, kinship, target);
    case 'sibling':
      return byGender(target, 'BHAI', 'BEHEN');
    case 'parents-sibling':
      return term.greats > 0 ? null : parentsSibling(kinship, target);
    case 'siblings-child':
      return term.greats > 0 ? null : siblingsChild(kinship, target);
    case 'cousin':
      // Hindi's cousin words are deliberately blind to birth order -- चचेरा covers both ताऊ's
      // children and चाचा's in ordinary speech -- but they only reach first cousins of the same
      // generation. Anything further out has no word, and English says it better.
      return term.degree !== 1 || term.removed !== 0 ? null : firstCousin(kinship, target);
    case 'spouse':
      return byGender(target, 'PATI', 'PATNI');
    case 'spouse-of':
      return marriedIn(term.relative, kinship, target);
    case 'of-spouse':
      return ofSpouse(term.relative, kinship, subject, target);
    default:
      return null;
  }
}
