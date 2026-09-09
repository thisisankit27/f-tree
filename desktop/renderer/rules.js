/*
 * Whether a proposed relationship is a sane thing to record.
 *
 * A port of `graph/RelationshipRules.kt`, and the reason the editor can be trusted with somebody's
 * family: without it a few clicks can make a person their own grandfather, and the layout engine
 * will then loop rather than draw.
 *
 * Ported deliberately as a *pure* module, exactly as the Kotlin is, because this is a second
 * implementation of rules that already exist in another language and can therefore drift. The
 * mitigation is that `rules.test.js` is the Kotlin's own test table, case for case: a divergence
 * fails a test here rather than surprising somebody's grandmother.
 *
 * The one deliberate difference is that nothing is asynchronous. The Kotlin suspends because its
 * answers come from a database; here the whole tree is already in memory, and threading promises
 * through a pure predicate would buy nothing but noise. The callback *shape* is kept so the two
 * read alike side by side.
 */

/** Edge kinds, mirroring `data/RelationshipType.kt`. Stored and compared by name. */
export const RelationshipType = Object.freeze({
  PARENT: 'PARENT',
  SPOUSE: 'SPOUSE',
  SIBLING: 'SIBLING',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Symmetric edges have no direction, so a duplicate can arrive either way round.
 *
 * PARENT is the odd one out and must stay so: reversing it is not the same statement, and treating
 * it as symmetric would let a child be recorded as their parent's parent without complaint.
 */
export function isSymmetric(type) {
  return type === RelationshipType.SPOUSE || type === RelationshipType.SIBLING;
}

/** Anything unrecognised becomes UNKNOWN rather than being dropped, as `fromName` does. */
export function relationshipTypeFrom(value) {
  return Object.hasOwn(RelationshipType, value) ? RelationshipType[value] : RelationshipType.UNKNOWN;
}

/** Why a proposed relationship was refused. The names match `RelationshipRejection`. */
export const Rejection = Object.freeze({
  SELF_REFERENCE: 'SELF_REFERENCE',
  DUPLICATE: 'DUPLICATE',
  ANCESTOR_CYCLE: 'ANCESTOR_CYCLE',
  CONTRADICTS_EXISTING: 'CONTRADICTS_EXISTING',
});

const ALLOWED = Object.freeze({ allowed: true });
const rejected = (reason) => Object.freeze({ allowed: false, reason });

/**
 * Everyone `id` descends from, walked upwards.
 *
 * Mirrors `FamilyGraph.ancestorsOf`, including the detail that makes it safe on a tree that is
 * already broken: a node equal to the start is skipped rather than followed, and every node is
 * visited once. An import can hand us a cycle, and a rule that hangs while checking for cycles
 * would be a poor joke.
 */
function ancestorsOf(id, parentsOf) {
  const found = new Set();
  const queue = [...parentsOf(id)];
  while (queue.length) {
    const node = queue.shift();
    if (node === id || found.has(node)) continue;
    found.add(node);
    queue.push(...parentsOf(node));
  }
  return found;
}

/** Would recording `parentId` as a parent of `childId` make somebody their own ancestor? */
export function wouldCreateAncestorCycle(parentId, childId, parentsOf) {
  return parentId === childId || ancestorsOf(parentId, parentsOf).has(childId);
}

/**
 * The check itself.
 *
 * Order matters and is the Kotlin's: self-reference, then duplicate, then contradiction, then
 * cycle. It decides which reason a person is told about when more than one applies, and the
 * sequence is chosen so the answer is the most specific true thing rather than the first one
 * noticed. A `PARENT` edge pointing back up an existing line is reported as a cycle, not as a
 * duplicate, because "that would make him his own grandfather" explains the refusal and
 * "you already have that" does not.
 *
 * @param {object} proposal
 * @param {string} proposal.from
 * @param {string} proposal.to
 * @param {string} proposal.type
 * @param {(from: string, to: string, type: string) => boolean} proposal.existingEdgeExists
 * @param {(id: string) => string[]} proposal.parentsOf
 * @returns {{allowed: true} | {allowed: false, reason: string}}
 */
export function checkRelationship({ from, to, type, existingEdgeExists, parentsOf }) {
  if (from === to) return rejected(Rejection.SELF_REFERENCE);

  const duplicate = existingEdgeExists(from, to, type)
    || (isSymmetric(type) && existingEdgeExists(to, from, type));
  if (duplicate) return rejected(Rejection.DUPLICATE);

  // A parent cannot also be a spouse or sibling of their own child.
  if (type !== RelationshipType.PARENT) {
    const alreadyParentChild = existingEdgeExists(from, to, RelationshipType.PARENT)
      || existingEdgeExists(to, from, RelationshipType.PARENT);
    if (alreadyParentChild) return rejected(Rejection.CONTRADICTS_EXISTING);
  }

  if (type === RelationshipType.PARENT && wouldCreateAncestorCycle(from, to, parentsOf)) {
    return rejected(Rejection.ANCESTOR_CYCLE);
  }

  return ALLOWED;
}
