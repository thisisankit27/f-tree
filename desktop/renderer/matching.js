/*
 * Deciding which people in an imported file are already in the tree.
 *
 * A port of `transfer/DuplicateMatcher.kt` and `transfer/NameKey.kt`. This is the most dangerous
 * code in either app, and the asymmetry that shapes it is worth stating before anything else:
 *
 *     wrongly keeping two records apart is a tidy-up somebody can fix in a minute.
 *     wrongly merging two records destroys data that cannot be recovered.
 *
 * So nothing here guesses. Only a *provable* match -- the file says where a person came from and
 * it is somebody we hold -- merges without asking. A strong match is proposed and can be refused.
 * A weak one is proposed as separate and has to be asked for.
 *
 * Pure, and handed both sides as plain data, so every rule is testable without a file or a
 * database. `matching.test.js` is the Kotlin's own test table.
 */

import { parsePartialDate } from './dates.js';

/** How confident we are that an imported person is somebody already here. */
export const MatchTier = Object.freeze({
  /** Provably the same person: the file says where they came from and it is someone we hold. */
  CERTAIN: 'CERTAIN',
  /** Same name, dates that agree, and at least one relative in common. */
  STRONG: 'STRONG',
  /** Same name and nothing that contradicts it. Could easily be a different person. */
  WEAK: 'WEAK',
  /** Nobody here looks like them. */
  NONE: 'NONE',
});

const MAX_PASSES = 5;

/**
 * A name reduced to what two spellings of the same person have in common.
 *
 * Accents, capitalisation, punctuation and stray spacing all differ between people typing the same
 * name into two different phones, and none of those differences mean it is a different person.
 *
 * Deliberately conservative: it normalises *form*, never content. "Raj Kumar" and "R. Kumar" stay
 * different, because guessing they are the same is how a merge quietly destroys somebody's data.
 *
 * `NFD` then stripping combining marks is the same normalisation the Kotlin does with
 * `java.text.Normalizer`; the `\p{L}\p{N}` classes need the `u` flag in JavaScript to mean what
 * they mean in Java.
 */
export function nameKey(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;
  const key = trimmed
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return key || null;
}

/** Whether the app merges this match without asking. */
export function mergesByDefault(match) {
  return match.tier === MatchTier.CERTAIN || match.tier === MatchTier.STRONG;
}

export function needsReview(match) {
  return match.tier === MatchTier.STRONG || match.tier === MatchTier.WEAK;
}

const evidence = ({ sameName = false, datesAgree = false, sharedRelatives = 0,
  fromSameTree = false } = {}) => ({ sameName, datesAgree, sharedRelatives, fromSameTree });

/**
 * Evidence for one candidate pairing, or null when something rules it out.
 *
 * Conflicting dates rule it out outright. Two people called Raj Kumar born eleven years apart are
 * two people, and merging them would be the worst thing an import could do.
 *
 * Note what is *not* required: that either date is present. Refusing to match two people who
 * plainly are the same because nobody wrote down when they were born would be its own kind of
 * wrong. Dates only ever veto here; they never qualify.
 */
function score(record, candidate, importedGraph, localGraph, settled) {
  const importedBirth = parsePartialDate(record.birthDate);
  const localBirth = parsePartialDate(candidate.birthDate);
  const bothKnown = Boolean(importedBirth && localBirth);
  if (bothKnown && !importedBirth.isCompatibleWith(localBirth)) return null;

  const importedDeath = parsePartialDate(record.deathDate);
  const localDeath = parsePartialDate(candidate.deathDate);
  if (importedDeath && localDeath && !importedDeath.isCompatibleWith(localDeath)) return null;

  const localNeighbours = localGraph.get(candidate.id) ?? new Set();
  let shared = 0;
  for (const neighbour of importedGraph.get(record.id) ?? new Set()) {
    const matchedLocal = settled.get(neighbour)?.localId;
    if (matchedLocal != null && localNeighbours.has(matchedLocal)) shared += 1;
  }

  return evidence({
    sameName: true,
    // Only claim the dates agree when there were dates to agree. This is shown to somebody as
    // reasoning, so it must not overstate what is known.
    datesAgree: bothKnown,
    sharedRelatives: shared,
  });
}

/**
 * Matches an imported file against the tree already open.
 *
 * Runs in passes. Provable matches settle first, and those confirmed matches then become evidence
 * for their relatives: two people with the same name are far likelier to be the same person once
 * their father has already matched. Passes repeat until nothing new is confirmed, bounded so a
 * strange file cannot make this run long.
 *
 * @param {object} args
 * @param {Array} args.imported   people from the file, in the exchange shape
 * @param {Map<string, Set<string>>} args.importedGraph  id to everyone directly connected
 * @param {Array} args.local      people already here
 * @param {Map<string, Set<string>>} args.localGraph
 * @param {Map<string, string>} args.originIndex  "treeId\\u0000personId" to the local person id
 * @param {string} args.sourceTreeId  the origin the file claims
 * @returns {Array<{importedId, localId, tier, evidence}>} one entry per imported person
 */
export function matchPeople({ imported, importedGraph, local, localGraph, originIndex,
  sourceTreeId }) {
  const localById = new Map(local.map((p) => [p.id, p]));
  const localByName = new Map();
  for (const person of local) {
    const key = nameKey(person.name);
    if (!key) continue;
    if (!localByName.has(key)) localByName.set(key, []);
    localByName.get(key).push(person);
  }

  const settled = new Map();
  const claimed = new Set();

  /*
   * Pass 0: provable identity.
   *
   * The file records where each person came from, so this is a lookup rather than a judgement --
   * the only kind of match trusted enough to merge without asking anybody.
   */
  for (const record of imported) {
    const keys = [originKey(sourceTreeId, record.id)];
    for (const origin of record.origins ?? []) keys.push(originKey(origin.treeId, origin.personId));

    const localId = keys.map((k) => originIndex.get(k)).find((v) => v != null);
    if (localId != null && localById.has(localId) && !claimed.has(localId)) {
      claimed.add(localId);
      settled.set(record.id, {
        importedId: record.id,
        localId,
        tier: MatchTier.CERTAIN,
        evidence: evidence({ fromSameTree: true }),
      });
    }
  }

  // Later passes: name plus corroboration, with confirmed matches feeding the next round.
  let pass = 0;
  let changed = true;
  while (changed && pass < MAX_PASSES) {
    pass += 1;
    changed = false;

    for (const record of imported) {
      if (settled.has(record.id)) continue;
      const key = nameKey(record.name);
      if (!key) continue;

      const candidates = (localByName.get(key) ?? []).filter((c) => !claimed.has(c.id));
      if (!candidates.length) continue;

      const scored = candidates
        .map((candidate) => ({
          candidate,
          found: score(record, candidate, importedGraph, localGraph, settled),
        }))
        .filter((s) => s.found !== null)
        .sort((a, b) => b.found.sharedRelatives - a.found.sharedRelatives);

      const best = scored[0];
      if (!best) continue;

      /*
       * Two local people with the same name and nothing to tell them apart. Proposing either
       * would be a coin toss, so neither is proposed.
       */
      const ambiguous = scored.length > 1
        && scored[1].found.sharedRelatives === best.found.sharedRelatives
        && best.found.sharedRelatives === 0;

      if (best.found.sharedRelatives > 0) {
        settled.set(record.id, {
          importedId: record.id,
          localId: best.candidate.id,
          tier: MatchTier.STRONG,
          evidence: best.found,
        });
        claimed.add(best.candidate.id);
        changed = true;
      } else if (!ambiguous) {
        settled.set(record.id, {
          importedId: record.id,
          localId: best.candidate.id,
          tier: MatchTier.WEAK,
          evidence: best.found,
        });
        // A weak match does not claim the local person: a better candidate may still turn up.
      }
    }
  }

  return imported.map((record) => settled.get(record.id) ?? ({
    importedId: record.id,
    localId: null,
    tier: MatchTier.NONE,
    evidence: evidence(),
  }));
}

/**
 * The key an origin is looked up by.
 *
 * A NUL separator rather than a colon or a dash, because a tree id is arbitrary text and any
 * printable separator could appear inside one -- at which point two different origins collide and
 * the import merges two people on the strength of a punctuation mark. The Kotlin uses a `Pair` and
 * has no such problem; JavaScript's Map needs the key flattened, so the separator has to be one
 * that cannot occur.
 */
export function originKey(treeId, personId) {
  return `${treeId}\u0000${personId}`;
}

/** Builds the neighbour map both sides are matched through. */
export function graphOf(edges) {
  const neighbours = new Map();
  const link = (a, b) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a).add(b);
  };
  for (const [from, to] of edges) { link(from, to); link(to, from); }
  return neighbours;
}
